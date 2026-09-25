import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const helper = join(root, 'scripts', 'configure-tailnet.mjs');
const psQuote = value => `'${value.replaceAll("'", "''")}'`;

export async function configureTailnet(action, directory) {
  const id = randomUUID(), resultFile = join(directory, `tailnet-setup-${id}.json`);
  mkdirSync(directory, { recursive: true });
  const command = `$ErrorActionPreference='Stop'; try { $p=Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(`"${helper}" ${id} ${action}`)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  // UAC itself remains visible; the non-interactive helper consoles stay hidden.
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-2000); });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  let result;
  if (existsSync(resultFile)) { result = JSON.parse(readFileSync(resultFile, 'utf8')); unlinkSync(resultFile); }
  if (code !== 0 || !result || result.error) {
    const detail = result?.error || diagnostics.trim();
    if (/0xc0000142/i.test(detail)) throw new Error('Windows 未能启动提权程序（0xc0000142）。请停止拾知后台，从资源管理器双击“启动拾知.cmd”后重试。');
    throw new Error(detail || `Tailscale 配置程序未返回结果（退出码 ${code ?? '未知'}）。若曾关闭黑色配置窗口，请重试；若再次出现，请检查 data/workstation.log。`);
  }
  return result;
}

export function createControl({ store, directory, tailnetAction = configureTailnet, canStop = false }) {
  const saved = store.get('settings', 'service-control') || store.put('settings', { id: 'service-control', mobileEnabled: true, remoteEnabled: false, tailnetUrl: '' });
  let state = saved, task = { status: 'idle', error: '' };
  const snapshot = () => ({ available: true, canStop, mobileEnabled: state.mobileEnabled, remoteEnabled: state.remoteEnabled, tailnetUrl: state.tailnetUrl || '', task });
  const setMobile = enabled => { state = store.put('settings', { ...state, mobileEnabled: enabled }); return snapshot(); };
  const tailnet = enabled => {
    if (task.status === 'running') throw Object.assign(new Error('Tailscale 配置仍在进行，请稍候。'), { status: 409 });
    if (!enabled) state = store.put('settings', { ...state, remoteEnabled: false });
    task = { status: 'running', action: enabled ? 'on' : 'off', error: '' };
    Promise.resolve().then(() => tailnetAction(enabled ? 'on' : 'off', directory)).then(result => {
      state = store.put('settings', { ...state, remoteEnabled: enabled, tailnetUrl: enabled ? result.url : '' });
      task = { status: 'done', action: enabled ? 'on' : 'off', error: '' };
    }).catch(error => { task = { status: 'failed', action: enabled ? 'on' : 'off', error: error.message }; });
    return snapshot();
  };
  return { snapshot, setMobile, tailnet, get mobileEnabled() { return state.mobileEnabled; }, get remoteEnabled() { return state.remoteEnabled; } };
}
