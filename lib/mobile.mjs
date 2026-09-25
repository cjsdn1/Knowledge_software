import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

const fail = (condition, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), { status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const clean = (s, max = 200) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const publicRun = run => { if (!run) return null; const { checkpoint, ...rest } = run; return rest; };

export function createMobile({ store, directory, config, runWorkflow, importDocument, importMedia, syncOperation }) {
  let identity = store.get('settings', 'server-identity');
  if (!identity) identity = store.put('settings', { id: 'server-identity', serverId: randomUUID() });
  const staging = join(directory, 'chunks'); mkdirSync(staging, { recursive: true });
  const completing = new Set(), controllers = new Map(), failures = new Map();
  let executing = false, stopped = false;
  for (const job of store.all('jobs').filter(j => j.status === 'running')) store.put('jobs', { ...job, status: 'interrupted', error: '电脑服务中断，可从已完成步骤继续。', updatedAt: new Date().toISOString() });
  const info = () => ({ serverId: identity.serverId, name: clean(config.SERVER_NAME) || '拾知电脑工作站', protocol: 2, serverTime: new Date().toISOString() });
  const deviceInfo = d => ({ id: d.id, name: d.name, createdAt: d.createdAt, revokedAt: d.revokedAt || null });
  const jobInfo = job => { const { payload, owner, requestHash, ...rest } = job; return { ...rest, run: publicRun(store.get('runs', job.runId || '')) }; };
  function device(token) {
    if (!token) return null;
    const hashed = digest(token);
    return store.all('devices').find(d => !d.revokedAt && equal(d.tokenHash, hashed)) || null;
  }
  const checkOwner = (record, auth) => fail(auth.admin || record.owner === auth.owner, '此记录不属于当前设备。', 403);
  async function pump() {
    if (executing || stopped) return;
    const job = store.all('jobs').reverse().find(j => j.status === 'queued');
    if (!job) return;
    executing = true;
    const controller = new AbortController(); controllers.set(job.id, controller);
    const save = patch => store.put('jobs', { ...store.get('jobs', job.id), ...patch, updatedAt: new Date().toISOString() });
    save({ status: 'running', attempts: (job.attempts || 0) + 1, error: null });
    try {
      const run = await runWorkflow(job.payload, {
        runId: job.runId, jobId: job.id, signal: controller.signal,
        progress: run => save({ runId: run.id, progress: Math.round(run.steps.filter(s => s.status === 'done').length / run.steps.length * 100) }),
      });
      save({ runId: run.id, status: controller.signal.aborted ? 'cancelled' : run.status, progress: run.status === 'done' ? 100 : store.get('jobs', job.id).progress, error: run.error || null, finishedAt: new Date().toISOString() });
    } catch (error) { save({ status: controller.signal.aborted ? 'cancelled' : 'failed', error: error.message }); }
    finally { controllers.delete(job.id); executing = false; if (!stopped) setImmediate(pump); }
  }
  const enqueue = () => { if (!stopped) setImmediate(pump); };
  enqueue();

  async function route({ path, method, body, auth, req, json }) {
    if (method === 'GET' && path === '/api/connection') return json(200, info());
    if (method === 'POST' && path === '/api/pairing/code') {
      fail(auth.admin, '请在电脑端生成配对码。', 403);
      const code = randomBytes(5).toString('hex').toUpperCase();
      // One outstanding code per PC; replacing it invalidates the previous code.
      store.put('pairing', { id: 'active-code', hash: digest(code), expiresAt: Date.now() + 5 * 60000, attempts: 0 });
      const port = String(req.headers.host || '').split(':').at(-1);
      const addresses = config.CONTROL_ENABLED === 'true' ? [] : Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${port}`);
      return json(201, { code, expiresAt: new Date(Date.now() + 5 * 60000).toISOString(), addresses, ...info() });
    }
    if (method === 'POST' && path === '/api/pairing/claim') {
      const ip = req.socket.remoteAddress || 'unknown', now = Date.now();
      for (const [key, entry] of failures) if (entry.until < now) failures.delete(key);
      const entry = failures.get(ip) || { count: 0, until: now + 60000 };
      fail(entry.count < 8, '配对尝试过于频繁，请一分钟后再试。', 429);
      entry.count++; failures.set(ip, entry);
      const pairing = store.get('pairing', 'active-code');
      fail(pairing && pairing.expiresAt > now && !pairing.used && pairing.attempts < 20, '配对码不存在、已使用或已过期，请在电脑端重新生成。', 401);
      store.put('pairing', { ...pairing, attempts: pairing.attempts + 1 });
      fail(equal(pairing.hash, digest(clean(body.code, 30).toUpperCase())), '配对码错误。', 401);
      const token = randomBytes(32).toString('base64url');
      const paired = store.transaction(() => {
        store.put('pairing', { ...pairing, used: true });
        return store.add('devices', { name: clean(body.name, 80) || '我的手机', tokenHash: digest(token) });
      });
      return json(201, { ...info(), device: deviceInfo(paired), token }, { 'Set-Cookie': `study_device=${token}; HttpOnly; SameSite=Strict; Path=/${req.socket.encrypted ? '; Secure' : ''}` });
    }
    if (path === '/api/devices' && method === 'GET') { fail(auth.admin, '仅电脑管理员可管理设备。', 403); return json(200, store.all('devices').map(deviceInfo)); }
    if (/^\/api\/devices\/[^/]+\/revoke$/.test(path) && method === 'POST') {
      fail(auth.admin, '仅电脑管理员可撤销设备。', 403);
      const d = store.get('devices', path.split('/')[3]); fail(d, '设备不存在。', 404);
      store.put('devices', { ...d, revokedAt: new Date().toISOString() });
      for (const job of store.all('jobs').filter(j => j.owner === d.id && ['queued', 'running'].includes(j.status))) {
        controllers.get(job.id)?.abort(new Error('设备授权已撤销。'));
        store.put('jobs', { ...job, status: 'cancelled', error: '设备授权已撤销。' });
      }
      return json(200, { ok: true });
    }
    if (method === 'POST' && path === '/api/jobs') {
      fail(uuid(body.clientId), '任务需要稳定的 clientId。');
      const old = store.get('jobs', body.clientId), hash = digest(JSON.stringify(body.payload));
      if (old) { checkOwner(old, auth); fail(old.requestHash === hash, '任务 ID 已用于不同内容。', 409); return json(200, jobInfo(old)); }
      fail(body.payload && typeof body.payload === 'object', '缺少任务内容。');
      if (body.payload.imageFileId) {
        fail(uuid(body.payload.imageFileId), '截图附件标识无效。');
        const file = store.get('files', body.payload.imageFileId);
        const upload = file && store.get('uploads', file.uploadId);
        fail(file && upload && upload.status === 'done' && upload.kind === 'media' && ['image/png', 'image/jpeg'].includes(upload.mime) && upload.courseId === body.payload.courseId, '截图附件未完成上传或课程不匹配。', 400);
        fail(auth.admin || upload.owner === auth.owner, '截图附件不属于当前设备。', 403);
      }
      if (body.payload.noteId) {
        const note = store.get('notes', body.payload.noteId);
        fail(body.payload.imageFileId && uuid(body.payload.noteId) && note && note.overlayJobId === body.clientId && note.courseId === body.payload.courseId && note.content.includes(`/api/files/${body.payload.imageFileId}`), '截图笔记与附件不匹配。', 400);
      }
      fail(store.all('jobs').filter(j => ['queued', 'running'].includes(j.status)).length < 50, '队列已满，请稍后重试。', 429);
      const job = store.put('jobs', { id: body.clientId, owner: auth.owner, requestHash: hash, payload: body.payload, name: clean(body.payload.request, 120) || '学习任务', courseId: body.payload.courseId, status: 'queued', progress: 0, attempts: 0, createdAt: new Date().toISOString() });
      enqueue(); return json(202, jobInfo(job));
    }
    if (method === 'GET' && path === '/api/jobs') return json(200, store.all('jobs').filter(j => auth.admin || j.owner === auth.owner).map(jobInfo));
    const overlayTextMatch = path.match(/^\/api\/documents\/([0-9a-f-]{36})\/overlay-text$/);
    if (method === 'GET' && overlayTextMatch) {
      fail(uuid(overlayTextMatch[1]), '文档标识无效。');
      const document = store.get('documents', overlayTextMatch[1]); fail(document, '文档不存在。', 404);
      const upload = document.uploadId && store.get('uploads', document.uploadId);
      fail(auth.admin || upload?.owner === auth.owner, '文档不属于当前设备。', 403);
      const text = document.pages.map((page, index) => `第 ${index + 1} 页\n${page.text || ''}`).join('\n\n').slice(0, 55000);
      return json(200, { id: document.id, courseId: document.courseId, text });
    }
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)(?:\/(cancel|retry))?$/);
    if (jobMatch) {
      const job = store.get('jobs', jobMatch[1]); fail(job, '任务不存在。', 404); checkOwner(job, auth);
      if (method === 'GET' && !jobMatch[2]) return json(200, jobInfo(job));
      if (method === 'POST' && jobMatch[2] === 'cancel') {
        if (job.status === 'running') controllers.get(job.id)?.abort(new Error('用户取消任务。'));
        if (['running', 'queued'].includes(job.status)) store.put('jobs', { ...job, status: 'cancelled', error: '用户取消任务。' });
        return json(200, jobInfo(store.get('jobs', job.id)));
      }
      if (method === 'POST' && jobMatch[2] === 'retry') {
        fail(['interrupted', 'failed', 'cancelled'].includes(job.status) && !controllers.has(job.id), '任务尚未停止或不需要重试。', 409);
        store.put('jobs', { ...job, status: 'queued', error: null }); enqueue(); return json(202, jobInfo(store.get('jobs', job.id)));
      }
    }
    if (method === 'POST' && path === '/api/uploads') {
      fail(uuid(body.clientId), '上传需要稳定的 clientId。');
      fail(['document', 'media'].includes(body.kind), '上传类型无效。');
      fail(Number.isInteger(body.size) && body.size > 0 && body.size <= 20 * 1024 * 1024, '文件应小于 20 MB。');
      fail(/^[a-f0-9]{64}$/.test(body.sha256 || ''), '缺少文件 SHA-256 校验值。');
      fail(store.get('settings', 'preferences').mode !== 'exam', '考试模式禁止上传。', 403);
      if (body.kind === 'document') fail(store.get('courses', body.courseId), '课程不存在。', 404);
      const old = store.get('uploads', body.clientId);
      if (old) { checkOwner(old, auth); fail(old.sha256 === body.sha256 && old.size === body.size && old.kind === body.kind && old.courseId === body.courseId && old.name === clean(body.name), '上传 ID 内容不匹配。', 409); return json(200, old); }
      const upload = store.put('uploads', { id: body.clientId, owner: auth.owner, kind: body.kind, name: clean(body.name), mime: clean(body.mime, 80), courseId: body.courseId, size: body.size, sha256: body.sha256, chunkSize: 256 * 1024, received: [], status: 'uploading', createdAt: new Date().toISOString() });
      mkdirSync(join(staging, upload.id), { recursive: true }); return json(201, upload);
    }
    const uploadMatch = path.match(/^\/api\/uploads\/([^/]+)(?:\/(chunks\/(\d+)|complete))?$/);
    if (uploadMatch) {
      const upload = store.get('uploads', uploadMatch[1]); fail(upload, '上传不存在。', 404); checkOwner(upload, auth);
      if (method === 'GET' && !uploadMatch[2]) return json(200, upload);
      fail(store.get('settings', 'preferences').mode !== 'exam', '考试模式禁止上传。', 403);
      if (method === 'PUT' && uploadMatch[3] !== undefined) {
        fail(upload.status !== 'done', '文件已经上传完成。', 409);
        const index = Number(uploadMatch[3]), count = Math.ceil(upload.size / upload.chunkSize);
        fail(index >= 0 && index < count, '分片序号无效。');
        fail(typeof body.data === 'string' && body.data.length <= 360000 && /^[A-Za-z0-9+/]*={0,2}$/.test(body.data), '分片格式无效。');
        const buffer = Buffer.from(body.data, 'base64'), bytes = index === count - 1 ? upload.size - index * upload.chunkSize : upload.chunkSize;
        fail(buffer.length === bytes, '分片长度不匹配。');
        const filename = join(staging, upload.id, String(index));
        if (upload.received.includes(index) && existsSync(filename)) fail(digest(readFileSync(filename)) === digest(buffer), '重复分片内容不一致。', 409);
        else writeFileSync(filename, buffer);
        if (!upload.received.includes(index)) upload.received.push(index);
        store.put('uploads', upload); return json(200, { received: upload.received, bytes });
      }
      if (method === 'POST' && uploadMatch[2] === 'complete') {
        if (upload.status === 'done') return json(200, upload.result);
        fail(!completing.has(upload.id), '文件正在合并，请稍后查询。', 409);
        fail(upload.received.length === Math.ceil(upload.size / upload.chunkSize), '分片尚未传完。', 409);
        completing.add(upload.id);
        try {
          const buffers = Array.from({ length: upload.received.length }, (_, i) => readFileSync(join(staging, upload.id, String(i))));
          const buffer = Buffer.concat(buffers); fail(digest(buffer) === upload.sha256, '文件校验失败，请重新选择原文件。', 422);
          const result = upload.kind === 'document' ? await importDocument(upload, buffer) : importMedia(upload, buffer);
          store.put('uploads', { ...upload, status: 'done', result });
          // Delete only this completed upload's numbered temporary chunks, never directories or user files.
          for (let i = 0; i < buffers.length; i++) { const file = join(staging, upload.id, String(i)); if (existsSync(file)) unlinkSync(file); }
          return json(200, result);
        } finally { completing.delete(upload.id); }
      }
    }
    if (method === 'POST' && path === '/api/sync') {
      fail(uuid(body.id), '离线操作需要稳定的 UUID。');
      const hash = digest(JSON.stringify(body)), receipt = store.get('receipts', body.id);
      if (receipt) { checkOwner(receipt, auth); fail(receipt.hash === hash, '操作 ID 与原内容不匹配。', 409); return json(200, receipt.result); }
      const result = store.transaction(() => {
        const result = syncOperation(body);
        store.put('receipts', { id: body.id, hash, owner: auth.owner, result, createdAt: new Date().toISOString() });
        return result;
      });
      return json(200, result);
    }
    return false;
  }
  return { route, info, device, close: async () => { stopped = true; for (const c of controllers.values()) c.abort(new Error('服务关闭。')); while (executing) await new Promise(r => setTimeout(r, 10)); } };
}
