import { spawn } from 'node:child_process';
import { openSync, closeSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const data = join(root, 'data'), log = join(data, 'workstation.log');
const url = 'http://127.0.0.1:4317/api/launcher-status';
mkdirSync(data, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function status() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

const current = await status();
if (current?.control) {
  console.log('拾知后台已运行，正在打开网页。');
  process.exit(0);
}
if (current) { console.error('4317 端口已有旧版工作站，请先停止旧窗口，再运行此启动器。'); process.exit(1); }
const fd = openSync(log, 'a');
const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'scripts/start-mobile.mjs'], {
  cwd: root, detached: true, windowsHide: true,
  env: { ...process.env, CONTROL_ENABLED: 'true', MOBILE_HOST: '127.0.0.1', PORT: '4317', REMOTE_PORT: '4319' },
  stdio: ['ignore', fd, fd],
});
child.unref(); closeSync(fd);
for (let i = 0; i < 24; i++) {
  await delay(500);
  const ready = await status();
  if (ready?.control) { console.log('拾知后台已启动，正在打开网页。'); process.exit(0); }
  if (ready && !ready.control) break;
}
console.error('后台未能启动。日志：' + log);
try { console.error(readFileSync(log, 'utf8').slice(-3000)); } catch {}
process.exit(1);
