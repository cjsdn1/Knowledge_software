import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import { createApp } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { calculate, planWorkflow, checkPermissions, validateSteps, parseCards, callModel } from '../lib/plugins.mjs';
import { parseDocument } from '../lib/documents.mjs';

function temp() { return mkdtempSync(join(tmpdir(), 'study-companion-test-')); }
function cleanup(path) { assert.ok(resolve(path).startsWith(resolve(tmpdir()) + sep)); assert.ok(path.includes('study-companion-test-')); rmSync(path, { recursive: true, force: true }); }
const defaultPreferences = { mode: 'study', network: true, disabledPlugins: [] };

test('calculator parses precedence and rejects execution and invalid arithmetic', () => {
  assert.equal(calculate('2 + 3 * (4 - 1)'), '2 + 3 * (4 - 1) = 11');
  assert.equal(calculate('-2^2'), '-2^2 = -4');
  assert.equal(calculate('2^3^2'), '2^3^2 = 512');
  assert.equal(calculate('2^-2'), '2^-2 = 0.25');
  for (const expression of ['process.exit()', '1/0', '2 3', '(1+2', '', '2**3']) assert.throws(() => calculate(expression));
});
test('planner composes tools and permissions deny AI in classroom and exam', () => {
  assert.deepEqual(planWorkflow('翻译并总结考点，保存到笔记', true), ['ocr', 'translate', 'summarize', 'save']);
  assert.throws(() => checkPermissions(['explain'], { ...defaultPreferences, mode: 'exam' }));
  assert.throws(() => checkPermissions(['calculator'], { ...defaultPreferences, mode: 'exam' }));
  assert.doesNotThrow(() => checkPermissions(['dictionary'], { ...defaultPreferences, mode: 'exam' }));
  assert.throws(() => checkPermissions(['explain'], { ...defaultPreferences, mode: 'classroom' }));
  assert.throws(() => checkPermissions(['translate'], { ...defaultPreferences, network: false }));
  assert.throws(() => checkPermissions(['dictionary'], { ...defaultPreferences, disabledPlugins: ['dictionary'] }));
  for (const steps of [['exec'], ['save', 'translate'], ['save', 'save'], []]) assert.throws(() => validateSteps(steps));
});
test('model cards must contain usable questions and answers', () => {
  assert.deepEqual(parseCards('```json\n[{"question":"Q","answer":"A"}]\n```'), [{ question: 'Q', answer: 'A' }]);
  for (const text of ['{}', '[]', '[{"question":"Q"}]', '[{"question":"","answer":"A"}]']) assert.throws(() => parseCards(text));
});
test('SQLite retains notes across restarts', () => {
  const dir = temp(); const first = createStore(dir); const record = first.add('notes', { content: 'persistent' }); first.close();
  const second = createStore(dir); assert.equal(second.get('notes', record.id).content, 'persistent'); second.close(); cleanup(dir);
});
test('PPTX pages are sorted numerically, entities decoded, invalid types rejected', async () => {
  const zip = new JSZip();
  zip.file('ppt/slides/slide10.xml', '<a:t>tenth</a:t>'); zip.file('ppt/slides/slide2.xml', '<a:t>second &amp; 中文</a:t>');
  const doc = await parseDocument('slides.pptx', await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(doc.pages[0].text, 'second & 中文'); assert.equal(doc.pages[1].text, 'tenth');
  await assert.rejects(parseDocument('not-image.png', Buffer.from('fake')));
  await assert.rejects(parseDocument('old.ppt', Buffer.from('fake')));
});
test('PDF parser extracts actual page text', async () => {
  const text = 'BT /F1 18 Tf 50 700 Td (Learning derivatives) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const doc = await parseDocument('lesson.pdf', Buffer.from(pdf)); assert.match(doc.pages[0].text, /Learning derivatives/);
});

test('API closes document, note, card, workflow and classroom loops', async t => {
  const dir = temp(); const { server, store } = createApp({ directory: dir, config: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await fetch(base)).status, 200);
  const initial = await request('/api/bootstrap'); const courseId = initial.data.courses[0].id;
  const imported = await request('/api/documents', { courseId, name: '课件.md', data: Buffer.from('Derivative is a rate of change.').toString('base64') });
  assert.equal(imported.status, 201); assert.equal(imported.data.pages.length, 1);
  const source = { documentId: imported.data.id, page: 1 };
  const note = await request('/api/notes', { courseId, title: '导数', content: '变化率', source }); assert.equal(note.status, 201);
  const edited = await request('/api/notes/' + note.data.id, { title: '导数定义', content: '瞬时变化率' }, 'PATCH'); assert.equal(edited.data.content, '瞬时变化率');
  const invalid = await request('/api/notes', { courseId, content: 'x', source: { ...source, page: 999 } }); assert.equal(invalid.status, 400);
  const card = await request('/api/cards', { courseId, question: '导数是什么？', answer: '瞬时变化率' });
  const reviewed = await request(`/api/cards/${card.data.id}/review`, { rating: 'good' }); assert.equal(reviewed.data.interval, 1); assert.equal(reviewed.data.reviews, 1);
  assert.equal((await request('/api/workflows', { name: '恶意', steps: ['shell'] })).status, 400);
  const run = await request('/api/run', { courseId, steps: ['calculator', 'save'], input: '2 + 3 * 4', request: '计算后保存', source });
  assert.equal(run.data.status, 'done'); assert.match(run.data.output, /14/); assert.ok(run.data.noteId);
  const session = await request('/api/sessions', { courseId, title: '微积分课堂' }); assert.equal(session.status, 201);
  assert.equal((await request('/api/run', { courseId, steps: ['explain'], input: 'x' })).status, 400);
  const event = await request(`/api/sessions/${session.data.id}/events`, { type: '疑问', text: '极限为什么存在？', source }); assert.equal(event.status, 201); assert.ok(event.data.offsetMs >= 0);
  const ended = await request(`/api/sessions/${session.data.id}/end`, {}); assert.ok(ended.data.noteId);
  assert.equal((await request(`/api/sessions/${session.data.id}/end`, {})).data.noteId, ended.data.noteId);
  await request('/api/settings', { mode: 'exam' }, 'PATCH');
  assert.equal((await request('/api/run', { courseId, steps: ['translate'], input: 'hello' })).status, 400);
  assert.equal((await request('/api/documents', { courseId, name: 'x.md', data: 'eA==' })).status, 403);
  const lookup = await request('/api/run', { courseId, steps: ['dictionary'], input: 'derivative' }); assert.match(lookup.data.output, /导数/);
  const foreign = await fetch(base + '/api/courses', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"name":"x"}' }); assert.equal(foreign.status, 403);
  assert.equal((await fetch(base + '/data/study.sqlite')).status, 404);
  const final = await request('/api/bootstrap'); assert.equal(final.data.notes.length, 3); assert.equal(final.data.preferences.mode, 'exam'); assert.ok(final.data.notes.some(n => n.content.includes('极限为什么存在')));
});
test('CRUD routes update and remove entities with cascade guards', async t => {
  const dir = temp(); const { server, store } = createApp({ directory: dir, config: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const bootstrap = async () => (await request('/api/bootstrap')).data;
  const courseId = (await bootstrap()).courses[0].id;

  // 卡片：可改内容，复习进度不受影响；空字段被拒
  const card = await request('/api/cards', { courseId, question: 'Q', answer: 'A' });
  await request(`/api/cards/${card.data.id}/review`, { rating: 'good' });
  const editedCard = await request(`/api/cards/${card.data.id}`, { question: 'Q2', answer: 'A2' }, 'PATCH');
  assert.equal(editedCard.data.question, 'Q2'); assert.equal(editedCard.data.reviews, 1); assert.equal(editedCard.data.interval, 1);
  assert.equal((await request(`/api/cards/${card.data.id}`, { question: '', answer: 'A' }, 'PATCH')).status, 400);

  // 资料删除三态：block 拒绝并给出计数、detach 保留文件、cascade 连引用一起删
  const imported = await request('/api/documents', { courseId, name: '课件.md', data: Buffer.from('Derivative is a rate of change.').toString('base64') });
  const note = await request('/api/notes', { courseId, title: '导数', content: '变化率', source: { documentId: imported.data.id, page: 1 } });
  const blocked = await request(`/api/documents/${imported.data.id}`, {}, 'DELETE');
  assert.equal(blocked.status, 409); assert.equal(blocked.data.counts.notes, 1);
  assert.equal((await request(`/api/documents/${imported.data.id}?refs=nonsense`, {}, 'DELETE')).status, 400);
  assert.equal((await request(`/api/documents/${imported.data.id}?refs=detach`, {}, 'DELETE')).status, 200);
  let snapshot = await bootstrap();
  assert.equal(snapshot.documents.length, 0);
  assert.equal(snapshot.notes.find(n => n.id === note.data.id).source, null);
  assert.ok(store.get('files', imported.data.fileId));
  assert.ok(existsSync(join(dir, 'uploads', imported.data.fileId)));
  assert.equal((await fetch(`${base}/api/files/${imported.data.fileId}`)).status, 200);

  const second = await request('/api/documents', { courseId, name: '第二份.md', data: Buffer.from('Entropy measures uncertainty.').toString('base64') });
  const linked = await request('/api/notes', { courseId, title: '熵', content: '不确定性', source: { documentId: second.data.id, page: 1 } });
  assert.equal((await request(`/api/documents/${second.data.id}?refs=cascade`, {}, 'DELETE')).status, 200);
  snapshot = await bootstrap();
  assert.equal(snapshot.notes.some(n => n.id === linked.data.id), false);
  assert.equal(store.get('files', second.data.fileId), null);
  assert.equal(existsSync(join(dir, 'uploads', second.data.fileId)), false);
  assert.equal((await fetch(`${base}/api/files/${second.data.fileId}`)).status, 404);

  // 笔记删除：指向它的课堂笔记引用被置空，重复删除返回 404
  const session = await request('/api/sessions', { courseId, title: '课堂' });
  const ended = await request(`/api/sessions/${session.data.id}/end`, {});
  assert.equal((await request(`/api/notes/${ended.data.noteId}`, {}, 'DELETE')).status, 200);
  snapshot = await bootstrap();
  assert.equal(snapshot.notes.some(n => n.id === ended.data.noteId), false);
  assert.equal(snapshot.sessions.find(s => s.id === session.data.id).noteId, null);
  assert.equal((await request(`/api/notes/${ended.data.noteId}`, {}, 'DELETE')).status, 404);

  // 工作流：可改名改步骤并递增版本，非法步骤被拒，可删除
  const workflow = await request('/api/workflows', { name: '计算归档', steps: ['calculator', 'save'] });
  const patched = await request(`/api/workflows/${workflow.data.id}`, { name: '计算并归档', steps: ['dictionary', 'save'] }, 'PATCH');
  assert.equal(patched.data.name, '计算并归档'); assert.equal(patched.data.version, 2); assert.deepEqual(patched.data.steps, ['dictionary', 'save']);
  assert.equal((await request(`/api/workflows/${workflow.data.id}`, { steps: ['save', 'translate'] }, 'PATCH')).status, 400);
  assert.equal((await request(`/api/workflows/${workflow.data.id}`, {}, 'DELETE')).status, 200);
  assert.equal((await request(`/api/workflows/${workflow.data.id}`, {}, 'DELETE')).status, 404);

  // 运行记录：进行中的拒绝删除，已完成的可删，可按状态批量清空
  const runA = await request('/api/run', { courseId, steps: ['calculator'], input: '3 * 5' }); assert.match(runA.data.output, /15/);
  const runB = await request('/api/run', { courseId, steps: ['dictionary'], input: 'derivative' }); assert.match(runB.data.output, /导数/);
  const active = store.add('runs', { courseId, request: '进行中', steps: [{ id: 'explain', status: 'running' }], status: 'running' });
  assert.equal((await request(`/api/runs/${active.id}`, {}, 'DELETE')).status, 409);
  assert.equal((await request(`/api/runs/${runA.data.id}`, {}, 'DELETE')).status, 200);
  assert.equal((await request(`/api/runs?courseId=${courseId}&status=done`, {}, 'DELETE')).data.removed, 1);
  assert.equal(store.get('runs', runB.data.id), null);

  // 课程：有子项拒绝、可迁移到其它课程、不可删最后一门、可级联清空
  const secondCourse = await request('/api/courses', { name: '第二门课' });
  const kept = await request('/api/notes', { courseId, title: '留在此课', content: '内容' });
  const blockedCourse = await request(`/api/courses/${courseId}`, {}, 'DELETE');
  assert.equal(blockedCourse.status, 409); assert.ok(blockedCourse.data.counts.notes >= 1);
  assert.equal((await request(`/api/courses/${courseId}`, {}, 'DELETE')).status, 409);
  assert.equal((await request(`/api/courses/${courseId}?target=${secondCourse.data.id}&cascade=true`, {}, 'DELETE')).status, 400);
  assert.equal((await request(`/api/courses/${courseId}?target=${secondCourse.data.id}`, {}, 'DELETE')).status, 200);
  snapshot = await bootstrap();
  assert.equal(snapshot.courses.length, 1);
  assert.equal(snapshot.notes.find(n => n.id === kept.data.id).courseId, secondCourse.data.id);
  assert.equal((await request(`/api/courses/${secondCourse.data.id}`, {}, 'DELETE')).status, 400);

  const third = await request('/api/courses', { name: '第三门课' });
  await request('/api/notes', { courseId: third.data.id, title: '待清理', content: 'x' });
  assert.equal((await request(`/api/courses/${third.data.id}?cascade=true`, {}, 'DELETE')).status, 200);
  snapshot = await bootstrap();
  assert.equal(snapshot.courses.length, 1);
  assert.equal(snapshot.notes.some(n => n.courseId === third.data.id), false);

  // 考试模式只读：实体修改与删除被拒
  const spare = await request('/api/notes', { courseId: secondCourse.data.id, title: '只读校验', content: 'x' });
  await request('/api/settings', { mode: 'exam' }, 'PATCH');
  assert.equal((await request(`/api/notes/${spare.data.id}`, {}, 'DELETE')).status, 403);
  assert.equal((await request(`/api/notes/${spare.data.id}`, { content: 'y' }, 'PATCH')).status, 403);
  assert.equal((await request(`/api/cards/${card.data.id}`, {}, 'DELETE')).status, 403);
  assert.equal((await request(`/api/courses/${secondCourse.data.id}?cascade=true`, {}, 'DELETE')).status, 403);
});
test('LAN API requires the configured access token and sets an HTTP-only session', async t => {
  const dir = temp(); const { server, store } = createApp({ directory: dir, config: { ACCESS_TOKEN: 'testing-secret-12345', TRUST_LOCAL_ADMIN: 'true' } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); cleanup(dir); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/bootstrap')).status, 401);
  assert.equal((await fetch(base + '/api/bootstrap', { headers: { 'X-Forwarded-For': '127.0.0.1', 'X-Forwarded-Proto': 'https' } })).status, 401);
  assert.equal((await fetch(base + '/api/pairing/code', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '127.0.0.1' }, body: '{}' })).status, 401);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'testing-secret-12345' }) });
  assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/bootstrap', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } })).status, 200);
});
test('model adapter sends selected image and bounded history, rejects missing configuration', async () => {
  await assert.rejects(callModel('explain', 'x', 'q', '', [], {}), /尚未配置/);
  const original = globalThis.fetch; let payload;
  globalThis.fetch = async (url, options) => { assert.equal(url, 'https://model.example/v1/chat/completions'); payload = JSON.parse(options.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '解释结果' } }] }) }; };
  try {
    assert.equal(await callModel('ocr', 'selected', '识别', 'data:image/png;base64,eA==', [], { AI_API_KEY: 'test-key', AI_MODEL: 'test-vision', AI_BASE_URL: 'https://model.example/v1/' }), '解释结果');
    assert.equal(payload.messages.at(-1).content[1].image_url.url, 'data:image/png;base64,eA==');
    assert.equal(payload.thinking, undefined);
    await callModel('explain', 'x', 'q', '', [], { AI_API_KEY: 'test-key', AI_MODEL: 'test-model', AI_BASE_URL: 'https://model.example/v1', AI_THINKING: 'disabled' });
    assert.equal(payload.thinking.type, 'disabled');
  } finally { globalThis.fetch = original; }
});
