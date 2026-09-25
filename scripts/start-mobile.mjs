import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
const directory = join(process.cwd(), 'data'); mkdirSync(directory, { recursive: true });
const keyFile = join(directory, 'mobile-access-key');
let key = process.env.ACCESS_TOKEN;
if (!key && existsSync(keyFile)) key = readFileSync(keyFile, 'utf8').trim();
if (!key) { key = randomBytes(32).toString('hex'); writeFileSync(keyFile, key, { flag: 'wx', mode: 0o600 }); }
if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) throw new Error('ACCESS_TOKEN 需要 16–128 位字母、数字或下划线。');
const host = process.env.CONTROL_ENABLED === 'true' ? '127.0.0.1' : process.env.MOBILE_HOST || '0.0.0.0', port = Number(process.env.PORT || 4317);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  const close = listener => new Promise(resolve => listener?.listening ? listener.close(resolve) : resolve());
  await Promise.all([close(server), close(remoteServer)]);
  await closeJobs(); store.close(); process.exit(0);
};
const { server, remoteServer, store, closeJobs } = createApp({ config: { ...process.env, ACCESS_TOKEN: key }, onStop: stop });
for (const listener of [server, remoteServer].filter(Boolean)) listener.on('error', error => { console.error('工作站监听失败：' + error.message); process.exit(1); });
if (remoteServer) remoteServer.listen(Number(process.env.REMOTE_PORT || 4319), '127.0.0.1');
server.listen(port, host, () => console.log(`拾知工作站已启动：http://127.0.0.1:${server.address().port}。管理员口令在 data/mobile-access-key。`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
