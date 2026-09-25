import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createApp } from '../server.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'study-mobile-test-'));
const pause = ms => new Promise(r => setTimeout(r, ms));
function cleanup(path) { assert.ok(resolve(path).startsWith(resolve(tmpdir()) + sep) && path.includes('study-mobile-test-')); rmSync(path, { recursive: true, force: true }); }
test('pairing, resumable upload, idempotent offline sync, background jobs, retry and revocation', async t => {
  const dir = temp(), app = createApp({ directory: dir, config: { ACCESS_TOKEN: 'admin-secret-access-token' } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await app.closeJobs(); app.store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const adminHeaders = { 'X-Access-Token': 'admin-secret-access-token' };
  const call = async (path, body, headers = {}, method = 'POST') => {
    const response = await fetch(base + '/api' + path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const initial = await call('/bootstrap', undefined, adminHeaders, 'GET'), courseId = initial.data.courses[0].id;
  assert.equal((await call('/bootstrap', undefined, {}, 'GET')).status, 401);
  const pair = await call('/pairing/code', {}, adminHeaders); assert.equal(pair.status, 201); assert.equal(pair.data.code.length, 10);
  assert.equal((await call('/pairing/claim', { code: 'WRONGCODE', name: 'Phone' })).status, 401);
  const claimed = await call('/pairing/claim', { code: pair.data.code, name: 'Phone' }); assert.equal(claimed.status, 201);
  assert.equal((await call('/pairing/claim', { code: pair.data.code, name: 'Other' })).status, 401);
  const phoneHeaders = { Authorization: 'Bearer ' + claimed.data.token };
  assert.equal((await call('/bootstrap', undefined, phoneHeaders, 'GET')).status, 200);
  assert.equal((await call('/devices', undefined, phoneHeaders, 'GET')).status, 403);
  const buffer = Buffer.from('Learning rate of change.\n'.repeat(15000)), uploadId = randomUUID();
  const uploadData = { clientId: uploadId, courseId, name: 'large.txt', kind: 'document', size: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), mime: 'text/plain' };
  const created = await call('/uploads', uploadData, phoneHeaders); assert.equal(created.status, 201); assert.equal(created.data.chunkSize, 256 * 1024);
  const chunk0 = { data: buffer.subarray(0, created.data.chunkSize).toString('base64') };
  assert.equal((await call(`/uploads/${uploadId}/chunks/0`, chunk0, phoneHeaders, 'PUT')).status, 200);
  assert.equal((await call(`/uploads/${uploadId}/chunks/0`, chunk0, phoneHeaders, 'PUT')).status, 200);
  assert.equal((await call(`/uploads/${uploadId}/chunks/0`, { data: Buffer.alloc(created.data.chunkSize, 1).toString('base64') }, phoneHeaders, 'PUT')).status, 409);
  assert.deepEqual((await call(`/uploads/${uploadId}`, undefined, phoneHeaders, 'GET')).data.received, [0]);
  for (let i = 1; i < Math.ceil(buffer.length / created.data.chunkSize); i++) await call(`/uploads/${uploadId}/chunks/${i}`, { data: buffer.subarray(i * created.data.chunkSize, (i + 1) * created.data.chunkSize).toString('base64') }, phoneHeaders, 'PUT');
  const completed = await call(`/uploads/${uploadId}/complete`, {}, phoneHeaders); assert.equal(completed.status, 200);
  assert.equal((await call(`/uploads/${uploadId}/complete`, {}, phoneHeaders)).data.id, completed.data.id);
  assert.equal((await call('/bootstrap', undefined, phoneHeaders, 'GET')).data.documents.length, 1);
  const documentText = await call(`/documents/${completed.data.id}/overlay-text`, undefined, phoneHeaders, 'GET');
  assert.equal(documentText.status, 200); assert.match(documentText.data.text, /Learning rate of change/);
  assert.equal((await call(`/documents/${completed.data.id}/overlay-text`, undefined, {}, 'GET')).status, 401);
  const documentJobId = randomUUID();
  assert.equal((await call('/jobs', { clientId: documentJobId, payload: { courseId, source: { documentId: completed.data.id, page: 1 }, input: documentText.data.text.slice(0, 200), request: '悬浮文档 · 保存笔记', steps: ['save'] } }, phoneHeaders)).status, 202);
  let documentJob;
  for (let i = 0; i < 40; i++) { documentJob = (await call('/jobs/' + documentJobId, undefined, phoneHeaders, 'GET')).data; if (documentJob.status === 'done') break; await pause(50); }
  assert.equal(documentJob.status, 'done'); assert.ok(documentJob.run.noteId);
  assert.equal(app.store.get('notes', documentJob.run.noteId).source.documentId, completed.data.id);
  const noteId = randomUUID(), syncId = randomUUID(), operation = { id: syncId, entityId: noteId, kind: 'note.create', payload: { courseId, title: '离线笔记', content: '保存一次' } };
  assert.equal((await call('/sync', operation, phoneHeaders)).status, 200);
  assert.equal((await call('/sync', operation, phoneHeaders)).data.id, noteId);
  assert.equal((await call('/sync', { ...operation, payload: { ...operation.payload, content: '其他内容' } }, phoneHeaders)).status, 409);
  assert.equal((await call('/bootstrap', undefined, phoneHeaders, 'GET')).data.notes.length, 2);
  const newer = await call('/sync', { id: randomUUID(), entityId: noteId, kind: 'note.update', payload: { title: '新版', content: '已更新', baseUpdatedAt: (await call('/bootstrap', undefined, phoneHeaders, 'GET')).data.notes[0].updatedAt } }, phoneHeaders);
  assert.equal(newer.status, 200);
  assert.equal((await call('/sync', { id: randomUUID(), entityId: noteId, kind: 'note.update', payload: { title: '冲突', content: '旧版本', baseUpdatedAt: operation.payload.createdAt } }, phoneHeaders)).status, 409);
  const jobId = randomUUID(), payload = { courseId, input: '2 + 3 * 4', request: '计算并归档', steps: ['calculator', 'save'] };
  assert.equal((await call('/jobs', { clientId: jobId, payload }, phoneHeaders)).status, 202);
  assert.equal((await call('/jobs', { clientId: jobId, payload }, phoneHeaders)).status, 200);
  let job; for (let i = 0; i < 40; i++) { job = (await call('/jobs/' + jobId, undefined, phoneHeaders, 'GET')).data; if (job.status === 'done') break; await pause(50); }
  assert.equal(job.status, 'done'); assert.equal(job.progress, 100); assert.match(job.run.output, /14/); assert.ok(job.run.noteId);
  const interruptedRun = app.store.add('runs', { courseId, request: '计算并归档', steps: [{ id: 'calculator', status: 'done' }, { id: 'save', status: 'failed' }], status: 'failed', checkpoint: { next: 1, input: '2 + 3 * 4 = 14', image: '', outputs: ['【计算器】\n2 + 3 * 4 = 14'] } });
  const resumeId = randomUUID(); app.store.put('jobs', { id: resumeId, owner: claimed.data.device.id, requestHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), payload, runId: interruptedRun.id, status: 'interrupted', progress: 50, attempts: 1 });
  assert.equal((await call(`/jobs/${resumeId}/retry`, {}, phoneHeaders)).status, 202);
  let resumed; for (let i = 0; i < 40; i++) { resumed = (await call(`/jobs/${resumeId}`, undefined, phoneHeaders, 'GET')).data; if (resumed.status === 'done') break; await pause(50); }
  assert.equal(resumed.status, 'done'); assert.ok(resumed.run.noteId); assert.equal(resumed.run.steps.filter(s => s.status === 'done').length, 2);
  assert.equal((await call('/devices/' + claimed.data.device.id + '/revoke', {}, adminHeaders)).status, 200);
  assert.equal((await call('/bootstrap', undefined, phoneHeaders, 'GET')).status, 401);
});

test('offline classroom records synchronize in event order and reject invalid times', async t => {
  const dir = temp(), app = createApp({ directory: dir, config: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await app.closeJobs(); app.store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async body => { const response = await fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const courseId = app.store.all('courses')[0].id, sessionId = randomUUID(), start = new Date(Date.now() - 5000).toISOString();
  assert.equal((await post({ id: randomUUID(), entityId: sessionId, kind: 'session.start', payload: { courseId, title: '离线课堂', startedAt: start } })).status, 200);
  assert.equal((await post({ id: randomUUID(), kind: 'event.create', payload: { sessionId, type: '疑问', text: '公式怎么推导', capturedAt: new Date(Date.now() - 3000).toISOString() } })).status, 200);
  assert.equal((await post({ id: randomUUID(), kind: 'event.create', payload: { sessionId, type: '重点', text: '无效时刻', capturedAt: new Date(Date.now() - 10000).toISOString() } })).status, 400);
  const ended = await post({ id: randomUUID(), entityId: sessionId, kind: 'session.end', payload: { endedAt: new Date().toISOString() } });
  assert.equal(ended.status, 200); assert.match(app.store.get('notes', ended.data.noteId).content, /公式怎么推导/);
});

test('offline deletions apply once, honour version checks and leave tombstones', async t => {
  const dir = temp(), app = createApp({ directory: dir, config: {} });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await app.closeJobs(); app.store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async body => { const response = await fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  const courseId = app.store.all('courses')[0].id;

  const noteId = randomUUID();
  const note = app.store.put('notes', { id: noteId, courseId, title: '待删笔记', content: '内容', updatedAt: new Date(Date.now() - 1000).toISOString() });
  // 电脑端已有更新版本时，离线删除必须让位
  assert.equal((await post({ id: randomUUID(), entityId: noteId, kind: 'note.delete', payload: { baseUpdatedAt: '2020-01-01T00:00:00.000Z' } })).status, 409);
  const deleted = await post({ id: randomUUID(), entityId: noteId, kind: 'note.delete', payload: { baseUpdatedAt: note.updatedAt } });
  assert.equal(deleted.status, 200); assert.equal(app.store.get('notes', noteId), null);
  assert.ok(app.store.get('tombstones', noteId));
  // 用新的操作 id 重放同一次删除必须幂等，而不是 404
  const replay = await post({ id: randomUUID(), entityId: noteId, kind: 'note.delete', payload: { baseUpdatedAt: note.updatedAt } });
  assert.equal(replay.status, 200); assert.equal(replay.data.alreadyDeleted, true);
  // tombstone 阻止离线设备用同一个 id 把电脑端已删的笔记创建回来
  assert.equal((await post({ id: randomUUID(), entityId: noteId, kind: 'note.create', payload: { courseId, title: '复活', content: 'x' } })).status, 409);

  // 卡片编辑与删除都以 baseReviews 做乐观并发校验
  const cardId = randomUUID();
  const card = app.store.put('cards', { id: cardId, courseId, question: 'Q', answer: 'A', dueAt: new Date().toISOString(), interval: 0, reviews: 0 });
  const updated = await post({ id: randomUUID(), entityId: cardId, kind: 'card.update', payload: { question: 'Q2', answer: 'A2', baseReviews: card.reviews } });
  assert.equal(updated.status, 200); assert.equal(updated.data.question, 'Q2'); assert.equal(updated.data.reviews, 0);
  assert.equal((await post({ id: randomUUID(), entityId: cardId, kind: 'card.update', payload: { question: 'Q3', answer: 'A3', baseReviews: 5 } })).status, 409);
  assert.equal((await post({ id: randomUUID(), entityId: cardId, kind: 'card.delete', payload: { baseReviews: 5 } })).status, 409);
  assert.equal((await post({ id: randomUUID(), entityId: cardId, kind: 'card.delete', payload: { baseReviews: card.reviews } })).status, 200);
  assert.equal(app.store.get('cards', cardId), null);
  assert.equal((await post({ id: randomUUID(), entityId: cardId, kind: 'card.create', payload: { courseId, question: 'Q4', answer: 'A4' } })).status, 409);

  // 考试模式下离线删除被拒
  app.store.put('settings', { ...app.store.get('settings', 'preferences'), mode: 'exam' });
  const spareId = randomUUID();
  const spare = app.store.put('notes', { id: spareId, courseId, title: '只读', content: 'x', updatedAt: new Date().toISOString() });
  assert.equal((await post({ id: randomUUID(), entityId: spareId, kind: 'note.delete', payload: { baseUpdatedAt: spare.updatedAt } })).status, 403);
});
test('overlay crop upload and model result are linked to one durable course note', async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => String(url).startsWith('https://model.example/')
    ? Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '识别到公式 f(x)=x²，导数为 2x。' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    : originalFetch(url, options);
  const dir = temp(), app = createApp({ directory: dir, config: { ACCESS_TOKEN: 'admin-secret-access-token', AI_API_KEY: 'test', AI_MODEL: 'vision', AI_BASE_URL: 'https://model.example/v1' } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { globalThis.fetch = originalFetch; await new Promise(resolve => app.server.close(resolve)); await app.closeJobs(); app.store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, body, headers = {}, method = 'POST') => {
    const response = await fetch(base + '/api' + path, { method, headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const admin = { 'X-Access-Token': 'admin-secret-access-token' }, courseId = app.store.all('courses')[0].id;
  const code = (await call('/pairing/code', {}, admin)).data.code;
  const paired = (await call('/pairing/claim', { code, name: 'Overlay phone' })).data;
  const phone = { Authorization: 'Bearer ' + paired.token };
  assert.equal((await call('/settings', { network: true }, admin, 'PATCH')).status, 200);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]), uploadId = randomUUID(), jobId = randomUUID(), noteId = randomUUID(), syncId = randomUUID();
  const upload = await call('/uploads', { clientId: uploadId, kind: 'media', courseId, name: 'crop.jpg', mime: 'image/jpeg', size: jpg.length, sha256: createHash('sha256').update(jpg).digest('hex') }, phone);
  assert.equal(upload.status, 201);
  assert.equal((await call(`/uploads/${uploadId}/chunks/0`, { data: jpg.toString('base64') }, phone, 'PUT')).status, 200);
  const file = await call(`/uploads/${uploadId}/complete`, {}, phone); assert.equal(file.status, 200);
  const operation = { id: syncId, entityId: noteId, kind: 'note.create', payload: { courseId, title: '悬浮圈选 · 解释', overlayJobId: jobId, content: `截图选区：[查看原图](/api/files/${file.data.id})` } };
  assert.equal((await call('/sync', operation, phone)).status, 200);
  const replay = await call('/sync', operation, phone); assert.equal(replay.data.id, noteId, JSON.stringify(replay));
  const payload = { courseId, imageFileId: file.data.id, noteId, steps: ['ocr'], input: '', request: '悬浮圈选 · 解释' };
  assert.equal((await call('/jobs', { clientId: randomUUID(), payload }, phone)).status, 400);
  assert.equal((await call('/jobs', { clientId: jobId, payload }, phone)).status, 202);
  let result;
  for (let i = 0; i < 40; i++) { result = (await call('/jobs/' + jobId, undefined, phone, 'GET')).data; if (result.status === 'done') break; await pause(50); }
  assert.equal(result.status, 'done'); assert.equal(result.run.noteId, noteId);
  const note = app.store.get('notes', noteId);
  assert.match(note.content, /导数为 2x/); assert.match(note.content, new RegExp(file.data.id));
  assert.equal(app.store.all('notes').filter(n => n.id === noteId).length, 1);
  // Lossless crops use the same durable upload and job path as JPEG crops.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZyQAAAAASUVORK5CYII=', 'base64');
  const pngUploadId = randomUUID(), pngJobId = randomUUID(), pngNoteId = randomUUID();
  const pngUpload = await call('/uploads', { clientId: pngUploadId, kind: 'media', courseId, name: 'crop.png', mime: 'image/png', size: png.length, sha256: createHash('sha256').update(png).digest('hex') }, phone);
  assert.equal(pngUpload.status, 201);
  assert.equal((await call(`/uploads/${pngUploadId}/chunks/0`, { data: png.toString('base64') }, phone, 'PUT')).status, 200);
  const pngFile = await call(`/uploads/${pngUploadId}/complete`, {}, phone); assert.equal(pngFile.status, 200);
  assert.equal((await call('/sync', { id: randomUUID(), entityId: pngNoteId, kind: 'note.create', payload: { courseId, title: '无损截图', overlayJobId: pngJobId, content: `截图选区：[查看原图](/api/files/${pngFile.data.id})` } }, phone)).status, 200);
  assert.equal((await call('/jobs', { clientId: pngJobId, payload: { courseId, imageFileId: pngFile.data.id, noteId: pngNoteId, steps: ['ocr'], input: '', request: '无损截图' } }, phone)).status, 202);
  let pngResult;
  for (let i = 0; i < 40; i++) { pngResult = (await call('/jobs/' + pngJobId, undefined, phone, 'GET')).data; if (pngResult.status === 'done') break; await pause(50); }
  assert.equal(pngResult.status, 'done');
  assert.match(app.store.get('notes', pngNoteId).content, /导数为 2x/);
});
