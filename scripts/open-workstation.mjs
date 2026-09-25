import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const url = 'http://127.0.0.1:4317/';
const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
const browser = candidates.find(existsSync) || 'explorer.exe';
const args = browser === 'explorer.exe' ? [url] : ['--new-window', url];
try {
  const child = spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  console.log('已向浏览器发送打开拾知网页的命令。');
} catch (error) {
  console.error('无法启动浏览器：' + error.message);
  process.exitCode = 1;
}
