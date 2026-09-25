import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const requestId = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(requestId || '')) throw new Error('配置请求 ID 无效');
const action = process.argv[3] || 'on';
if (!['on', 'off'].includes(action)) throw new Error('Tailscale 操作无效');
const resultFile = join(root, 'data', `tailnet-setup-${requestId}.json`);
mkdirSync(dirname(resultFile), { recursive: true });
const options = [process.env.TAILSCALE_CLI, 'D:\\Tools\\Tailscale\\tailscale.exe', 'C:\\Program Files\\Tailscale\\tailscale.exe', 'tailscale.exe'].filter(Boolean);
const executable = options.find(path => path === 'tailscale.exe' || existsSync(path));
function run(args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || 'Tailscale 命令失败').trim());
  return result.stdout.trim();
}
try {
  if (!executable) throw new Error('未找到 Tailscale，请先安装。');
  if (action === 'off') {
    run(['serve', '--yes', '--https=443', 'off']);
    writeFileSync(resultFile, JSON.stringify({ off: true }));
    process.exit(0);
  }
  const status = JSON.parse(run(['status', '--json']));
  if (status.BackendState !== 'Running') throw new Error('请先在电脑 Tailscale 客户端完成登录并连接网络。');
  const dns = status.Self?.DNSName?.replace(/\.$/, '');
  if (!dns || !/^[a-z0-9.-]+\.ts\.net$/i.test(dns)) throw new Error('Tailscale 未返回有效的 *.ts.net 地址，请检查 MagicDNS。');
  // Serve is private to the tailnet. Never use the public Funnel command here.
  run(['serve', '--yes', '--bg', '--https=443', '127.0.0.1:4319']);
  writeFileSync(resultFile, JSON.stringify({ url: `https://${dns}` }));
} catch (error) {
  writeFileSync(resultFile, JSON.stringify({ error: error.message }));
  process.exitCode = 1;
}
