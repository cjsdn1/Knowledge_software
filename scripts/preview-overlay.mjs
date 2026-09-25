import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const files = new Map([
  ['/overlay-plan.html', ['text/html; charset=utf-8', 'overlay-plan.html']],
  ['/overlay-plan.css', ['text/css; charset=utf-8', 'overlay-plan.css']],
  ['/overlay-plan.js', ['text/javascript; charset=utf-8', 'overlay-plan.js']],
  ['/icon.svg', ['image/svg+xml', 'icon.svg']]
]);
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/') { response.writeHead(302, { Location: '/overlay-plan.html' }); response.end(); return; }
  const file = files.get(pathname);
  if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': file[0], 'Cache-Control': 'no-store' });
  response.end(request.method === 'HEAD' ? undefined : readFileSync(join(root, file[1])));
});
server.listen(Number(process.env.OVERLAY_PREVIEW_PORT || 4318), '127.0.0.1', () => {
  console.log(`拾知悬浮窗规划页：http://127.0.0.1:${server.address().port}/overlay-plan.html`);
});
