import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createStore } from './lib/store.mjs';
import { parseDocument, MAX_FILE_BYTES } from './lib/documents.mjs';
import { plugins, defaultWorkflows, planWorkflow, validateSteps, checkPermissions, calculate, lookup, callModel, parseCards } from './lib/plugins.mjs';
import { createMobile, publicRun } from './lib/mobile.mjs';
import { createSync } from './lib/sync.mjs';
import { createRemoval } from './lib/removal.mjs';
import { createControl } from './lib/control.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const str = (value, max = 10000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const ensure = (condition, message, status = 400) => { if (!condition) throw Object.assign(new Error(message), { status }); };

export function createApp({ directory = join(root, 'data'), config = process.env, tailnetAction, onStop } = {}) {
  if (config.CONTROL_ENABLED === 'true') ensure(/^[A-Za-z0-9_-]{16,128}$/.test(config.ACCESS_TOKEN || ''), '电脑服务控制台需要管理员口令。');
  const store = createStore(directory);
  for (const run of store.all('runs').filter(r => r.status === 'running')) {
    store.put('runs', { ...run, status: 'failed', error: '服务曾中断，请查看已完成步骤后重新运行。', steps: run.steps.map(s => s.status === 'running' ? { ...s, status: 'failed' } : s), finishedAt: new Date().toISOString() });
  }
  const uploads = join(directory, 'uploads');
  mkdirSync(uploads, { recursive: true });
  const removal = createRemoval({ store, uploadsDirectory: uploads });
  const preferences = () => store.get('settings', 'preferences');
  const course = id => { ensure(store.get('courses', id), '课程不存在。', 404); return id; };
  const entity = (kind, id) => { const item = store.get(kind, id); ensure(item, '记录不存在。', 404); return item; };
  // 与既有分散写法（documents/sessions/events/media 处）保持同一语义：考试模式只读，禁增删改。
  const guardWrite = (message = '考试模式禁止修改学习记录。') => ensure(preferences().mode !== 'exam', message, 403);
  const requireAdmin = auth => ensure(auth.admin, '请在电脑端执行此操作。', 403);
  const source = data => {
    if (!data?.documentId) return null;
    const doc = entity('documents', data.documentId);
    const page = Number(data.page || 1);
    ensure(Number.isInteger(page) && page > 0 && page <= doc.pages.length, '页码无效。');
    return { documentId: doc.id, name: doc.name, page };
  };
  const addNote = data => store.add('notes', { courseId: course(data.courseId), title: str(data.title, 150) || '学习笔记', content: str(data.content, 150000), source: data.source || null, sessionId: data.sessionId || null, tags: Array.isArray(data.tags) ? data.tags.slice(0, 8).map(t => str(t, 30)) : [], updatedAt: new Date().toISOString() });
  const saveFile = (buffer, name, mime) => {
    const file = store.add('files', { name, mime, bytes: buffer.length });
    writeFileSync(join(uploads, file.id), buffer);
    return file;
  };
  async function runWorkflow(body, hooks = {}) {
    course(body.courseId);
    if (body.noteId) {
      ensure(body.imageFileId && hooks.jobId, '截图笔记只能由后台任务更新。', 403);
      const captureNote = entity('notes', body.noteId);
      ensure(captureNote.courseId === body.courseId && captureNote.overlayJobId === hooks.jobId, '截图笔记课程或任务不匹配。', 400);
    }
    const request = str(body.request, 2000) || '解释这段学习材料';
    const steps = validateSteps(body.steps || planWorkflow(request, Boolean(body.image)));
    checkPermissions(steps, preferences());
    const imageFileId = body.imageFileId || '';
    let image = body.image || '';
    if (imageFileId) {
      const file = entity('files', imageFileId);
      ensure(['image/png', 'image/jpeg'].includes(file.mime) && file.bytes <= 8 * 1024 * 1024, '截图附件无效或过大。');
      image = `data:${file.mime};base64,${readFileSync(join(uploads, file.id)).toString('base64')}`;
    }
    ensure(typeof image === 'string' && (!image || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)), '圈选图片格式无效。');
    ensure(image.length <= 12 * 1024 * 1024, '圈选图片过大，请缩小范围。');
    const origin = source(body.source);
    if (origin) ensure(entity('documents', origin.documentId).courseId === body.courseId, '来源不属于当前课程。');
    let input = str(body.input, 60000);
    ensure(input || image, '请先选取文字、图片或输入材料。');
    const run = (hooks.runId && store.get('runs', hooks.runId)) || store.add('runs', { courseId: body.courseId, request, steps: steps.map(id => ({ id, status: 'pending' })), status: 'running', source: origin, imageFileId: imageFileId || null, noteId: body.noteId || null });
    const outputs = run.checkpoint?.outputs || [];
    const from = run.checkpoint?.next || 0;
    if (run.checkpoint) { input = run.checkpoint.input; image = run.checkpoint.image; }
    run.status = 'running'; delete run.error;
    hooks.progress?.(run);
    try {
      for (const [i, step] of steps.entries()) {
        if (i < from) continue;
        hooks.signal?.throwIfAborted();
        // Re-check preferences between awaits, so revocation stops later steps.
        checkPermissions([step], preferences());
        run.steps[i].status = 'running'; store.put('runs', run); hooks.progress?.(run);
        let generatedCards;
        if (!['save', 'calculator', 'dictionary'].includes(step)) {
          input = await callModel(step, input, request, image, Array.isArray(body.history) ? body.history : [], config, hooks.signal);
          hooks.signal?.throwIfAborted();
          checkPermissions([step], preferences());
          if (step === 'cards') generatedCards = parseCards(input);
        }
        store.transaction(() => {
        if (step === 'save') {
          const attachment = imageFileId ? `\n\n截图选区：[查看原图](/api/files/${imageFileId})` : '';
          const content = (outputs.join('\n\n') || input) + attachment;
          if (run.noteId) store.put('notes', { ...entity('notes', run.noteId), content, updatedAt: new Date().toISOString() });
          else run.noteId = addNote({ courseId: body.courseId, title: request, content, source: origin, tags: ['工具流程'] }).id;
        } else if (step === 'calculator') input = calculate(input);
        else if (step === 'dictionary') input = lookup(input);
        else {
          if (generatedCards) {
            const cards = generatedCards.map(c => store.add('cards', { ...c, courseId: body.courseId, source: origin, dueAt: new Date().toISOString(), interval: 0, reviews: 0 }));
            run.cardIds = cards.map(c => c.id);
            input = cards.map(c => `问：${c.question}\n答：${c.answer}`).join('\n\n');
          }
        }
        if (step !== 'save') outputs.push(`【${plugins.find(p => p.id === step).name}】\n${input}`);
        run.steps[i].status = 'done';
        if (step === 'ocr') image = '';
        run.checkpoint = { next: i + 1, input, image, outputs: [...outputs] };
        store.put('runs', run);
        });
        hooks.progress?.(run);
      }
      store.transaction(() => {
      if (imageFileId) {
        const content = (outputs.join('\n\n') || input) + `\n\n截图选区：[查看原图](/api/files/${imageFileId})`;
        if (run.noteId) store.put('notes', { ...entity('notes', run.noteId), content, updatedAt: new Date().toISOString() });
        else run.noteId = addNote({ courseId: body.courseId, title: request, content, source: origin, tags: ['悬浮截图'] }).id;
      } else if (!run.noteId && preferences().autoSave && preferences().mode === 'study' && !preferences().disabledPlugins.includes('save') && !steps.every(s => ['dictionary', 'calculator'].includes(s))) {
        run.noteId = addNote({ courseId: body.courseId, title: request, content: outputs.join('\n\n'), source: origin, tags: ['自动整理'] }).id;
      }
      run.status = 'done'; run.output = outputs.join('\n\n') || input;
      store.put('runs', run);
      });
    } catch (error) {
      const step = run.steps.find(s => s.status === 'running');
      if (step) step.status = 'failed';
      run.status = hooks.signal?.aborted ? 'cancelled' : 'failed'; run.error = error.message; run.output = outputs.join('\n\n');
      if (imageFileId) {
        const content = (run.output ? run.output + '\n\n' : '') + `处理未完成：${run.error}\n\n截图选区：[查看原图](/api/files/${imageFileId})`;
        if (run.noteId) store.put('notes', { ...entity('notes', run.noteId), content, updatedAt: new Date().toISOString() });
        else run.noteId = addNote({ courseId: body.courseId, title: request, content, source: origin, tags: ['悬浮截图'] }).id;
      }
    }
    run.finishedAt = new Date().toISOString();
    return store.put('runs', run);
  }

  const mobile = createMobile({ store, directory, config, runWorkflow, syncOperation: createSync(store, removal),
    importDocument: async (upload, buffer) => {
      const parsed = await parseDocument(upload.name, buffer);
      ensure(preferences().mode !== 'exam', '考试模式禁止导入。', 403);
      return store.transaction(() => { const prior = store.all('documents').find(d => d.uploadId === upload.id); if (prior) return prior; const file = saveFile(buffer, upload.name, parsed.mime); return store.add('documents', { ...parsed, name: upload.name, courseId: course(upload.courseId), fileId: file.id, bytes: buffer.length, uploadId: upload.id }); });
    },
    importMedia: (upload, buffer) => {
      ensure(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'image/png', 'image/jpeg', 'image/webp'].includes(upload.mime), '媒体类型不支持。');
      return store.all('files').find(f => f.uploadId === upload.id) || store.transaction(() => { const file = store.add('files', { name: upload.name, mime: upload.mime, bytes: buffer.length, uploadId: upload.id }); writeFileSync(join(uploads, file.id), buffer); return file; });
    },
  });

  const control = config.CONTROL_ENABLED === 'true' ? createControl({ store, directory, tailnetAction, canStop: Boolean(onStop) }) : null;
  const handle = async (req, res, side) => {
    const json = (status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
    try {
      if (side === 'remote' && (!control?.remoteEnabled || !control.mobileEnabled)) return json(503, { error: '手机或异网访问已在电脑端关闭。' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
      const url = new URL(req.url, `http://${req.headers.host}`);
      // Block cross-site writes, DNS rebinding, and accidental exposure through permissive CORS.
      const host = url.hostname;
      const allowed = ['127.0.0.1', 'localhost', '[::1]'];
      if (!config.ACCESS_TOKEN) ensure(allowed.includes(host), '局域网访问需要设置 ACCESS_TOKEN。', 403);
      if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) ensure(req.headers.origin === url.origin, '拒绝跨站请求。', 403);
      const token = config.ACCESS_TOKEN;
      const cookie = req.headers.cookie?.split('; ').find(c => c.startsWith('study_token='))?.slice(12);
      const supplied = req.headers['x-access-token'] || cookie || '';
      // A local reverse proxy (including Tailscale Serve) also connects from loopback.
      // Never treat the socket address or forwarded headers as administrator identity.
      const admin = !token || (Buffer.byteLength(supplied) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(supplied), Buffer.from(token)));
      const deviceToken = req.headers.authorization?.replace(/^Bearer /, '') || req.headers.cookie?.split('; ').find(c => c.startsWith('study_device='))?.slice(13);
      const paired = mobile.device(deviceToken);
      const auth = { admin, owner: paired?.id || 'admin' };
      const publicPaths = ['/api/login', '/api/connection', '/api/pairing/claim', '/api/launcher-status'];
      if (url.pathname.startsWith('/api/') && !publicPaths.includes(url.pathname)) ensure(admin || paired, '设备未配对或授权已撤销。', 401);
      if (control && !control.mobileEnabled && !admin && (paired || url.pathname === '/api/pairing/claim')) ensure(false, '电脑端已关闭手机接入。', 503);
      let body = {};
      if (!['GET', 'HEAD'].includes(req.method)) {
        ensure(req.headers['content-type']?.startsWith('application/json'), '需要 JSON 请求。', 415);
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; ensure(bytes <= 30 * 1024 * 1024, '请求超过 30 MB。', 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new Error('JSON 格式无效。'); }
        ensure(body && typeof body === 'object' && !Array.isArray(body), '请求格式无效。');
      }
      const path = url.pathname;
      if (req.method === 'GET' && path === '/api/launcher-status') return json(200, { ok: true, control: Boolean(control) });
      if (path.startsWith('/api/control')) {
        ensure(control && side === 'local' && ['127.0.0.1', '::1'].includes(req.socket.localAddress) && admin, '仅电脑本机管理员可控制服务。', 403);
        if (req.method === 'GET' && path === '/api/control') return json(200, control.snapshot());
        if (req.method === 'POST' && path === '/api/control/mobile') { ensure(typeof body.enabled === 'boolean', '开关值无效。'); return json(200, control.setMobile(body.enabled)); }
        if (req.method === 'POST' && path === '/api/control/tailnet') { ensure(typeof body.enabled === 'boolean', '开关值无效。'); return json(202, control.tailnet(body.enabled)); }
        if (req.method === 'POST' && path === '/api/control/stop') {
          ensure(onStop, '当前启动方式不支持网页停止。', 501);
          json(200, { ok: true });
          setTimeout(onStop, 150).unref();
          return;
        }
        return json(404, { error: '控制接口不存在。' });
      }
      if (req.method === 'POST' && ['PATCH', 'DELETE'].includes(String(req.headers['x-study-method']).toUpperCase())) {
        ensure(admin || paired, '设备未授权。', 401);
        req.method = String(req.headers['x-study-method']).toUpperCase();
      }
      if (await mobile.route({ path, method: req.method, body, auth, req, json }) !== false) return;
      if (req.method === 'POST' && path === '/api/login') {
        const candidate = str(body.token, 1000);
        ensure(token && Buffer.byteLength(candidate) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(candidate), Buffer.from(token)), '访问口令错误。', 401);
        res.setHeader('Set-Cookie', `study_token=${candidate}; HttpOnly; SameSite=Strict; Path=/${req.socket.encrypted ? '; Secure' : ''}`);
        return json(200, { ok: true });
      }
      if (req.method === 'GET' && path === '/api/bootstrap') return json(200, { ...Object.fromEntries(['courses', 'documents', 'notes', 'cards', 'sessions', 'events', 'workflows'].map(k => [k, store.all(k)])), runs: store.all('runs').map(publicRun), connection: { ...mobile.info(), admin, deviceId: paired?.id }, control: side === 'local' && admin ? control?.snapshot() || null : null, preferences: preferences(), plugins, defaultWorkflows, model: { configured: Boolean(config.AI_API_KEY && config.AI_MODEL), name: config.AI_MODEL || '', transcription: Boolean(config.AI_API_KEY && config.AI_TRANSCRIBE_MODEL) } });
      if (req.method === 'PATCH' && path === '/api/settings') {
        const p = preferences();
        if (body.mode !== undefined) { ensure(['study', 'classroom', 'exam'].includes(body.mode), '模式无效。'); p.mode = body.mode; }
        for (const k of ['network', 'autoSave']) if (body[k] !== undefined) { ensure(typeof body[k] === 'boolean', '设置类型错误。'); p[k] = body[k]; }
        if (body.disabledPlugins !== undefined) { ensure(Array.isArray(body.disabledPlugins) && body.disabledPlugins.every(id => plugins.some(p => p.id === id)), '工具列表无效。'); p.disabledPlugins = body.disabledPlugins; }
        return json(200, store.put('settings', p));
      }
      if (req.method === 'POST' && path === '/api/courses') { ensure(str(body.name, 80), '请输入课程名称。'); return json(201, store.add('courses', { name: str(body.name, 80), color: 'sage' })); }
      if (req.method === 'POST' && path === '/api/documents') {
        course(body.courseId);
        ensure(preferences().mode !== 'exam', '考试模式禁止导入新材料。', 403);
        ensure(typeof body.data === 'string', '文件数据缺失。');
        const buffer = Buffer.from(body.data, 'base64');
        const name = str(body.name, 200);
        const parsed = await parseDocument(name, buffer);
        ensure(preferences().mode !== 'exam', '已切换为考试模式，导入已停止。', 403);
        const file = saveFile(buffer, name, parsed.mime);
        return json(201, store.add('documents', { ...parsed, name, courseId: body.courseId, fileId: file.id, bytes: buffer.length }));
      }
      if (req.method === 'GET' && path.startsWith('/api/files/')) {
        const file = entity('files', path.slice('/api/files/'.length));
        res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=0', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}` });
        return res.end(readFileSync(join(uploads, file.id)));
      }
      if (req.method === 'POST' && path === '/api/notes') {
        ensure(str(body.content, 150000), '笔记内容不能为空。');
        const origin = source(body.source);
        if (origin) ensure(entity('documents', origin.documentId).courseId === body.courseId, '来源不属于当前课程。');
        return json(201, addNote({ ...body, source: origin }));
      }
      if (req.method === 'PATCH' && path.startsWith('/api/notes/')) {
        guardWrite();
        const note = entity('notes', path.split('/').at(-1));
        ensure(str(body.content, 150000), '笔记内容不能为空。');
        return json(200, store.put('notes', { ...note, title: str(body.title, 150) || note.title, content: str(body.content, 150000), updatedAt: new Date().toISOString() }));
      }
      if (req.method === 'POST' && path === '/api/cards') {
        ensure(str(body.question, 2000) && str(body.answer, 8000), '请输入问题和答案。');
        return json(201, store.add('cards', { courseId: course(body.courseId), question: str(body.question, 2000), answer: str(body.answer, 8000), dueAt: new Date().toISOString(), interval: 0, reviews: 0 }));
      }
      if (req.method === 'POST' && /^\/api\/cards\/[^/]+\/review$/.test(path)) {
        const card = entity('cards', path.split('/')[3]);
        ensure(['again', 'good', 'easy'].includes(body.rating), '评分无效。');
        const days = body.rating === 'again' ? 0 : body.rating === 'easy' ? Math.max(4, card.interval * 3) : Math.max(1, card.interval * 2);
        return json(200, store.put('cards', { ...card, interval: days, reviews: card.reviews + 1, dueAt: new Date(Date.now() + (days ? days * 86400000 : 600000)).toISOString() }));
      }
      if (req.method === 'POST' && path === '/api/sessions') {
        ensure(preferences().mode !== 'exam', '考试模式不可开启课堂记录。', 403);
        ensure(!store.all('sessions').some(s => !s.endedAt), '已有课堂正在记录，请先结束。');
        const session = store.add('sessions', { courseId: course(body.courseId), title: str(body.title, 120) || '课堂记录', startedAt: new Date().toISOString(), endedAt: null });
        store.put('settings', { ...preferences(), mode: 'classroom' });
        return json(201, session);
      }
      if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/events$/.test(path)) {
        const session = entity('sessions', path.split('/')[3]);
        ensure(!session.endedAt, '课堂已经结束。');
        ensure(preferences().mode !== 'exam', '考试模式不可添加课堂记录。', 403);
        ensure(['重点', '疑问', '页码', '板书', '圈选', '录音', '文字'].includes(body.type), '记录类型无效。');
        const origin = source(body.source);
        if (origin) ensure(entity('documents', origin.documentId).courseId === session.courseId, '课堂记录的来源必须属于同一课程。');
        if (body.fileId) entity('files', body.fileId);
        const capturedAt = body.capturedAt ? Date.parse(body.capturedAt) : Date.now();
        ensure(Number.isFinite(capturedAt) && capturedAt >= Date.parse(session.startedAt) && capturedAt <= Date.now() + 1000, '记录时间不在本次课堂范围内。');
        const durationMs = Number(body.durationMs || 0);
        ensure(Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 360000, '录音片段时长无效。');
        return json(201, store.add('events', { sessionId: session.id, courseId: session.courseId, type: body.type, text: str(body.text, 10000), source: origin, fileId: body.fileId || null, offsetMs: capturedAt - Date.parse(session.startedAt), durationMs }));
      }
      if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/end$/.test(path)) {
        const session = entity('sessions', path.split('/')[3]);
        if (session.endedAt) return json(200, session);
        const events = store.all('events').filter(e => e.sessionId === session.id).sort((a, b) => a.offsetMs - b.offsetMs);
        const content = `# ${session.title}\n\n课堂时间：${session.startedAt}\n\n` + (events.length ? events.map(e => `- [${Math.floor(e.offsetMs / 60000)}:${String(Math.floor(e.offsetMs / 1000) % 60).padStart(2, '0')}] ${e.type}：${e.text || '已记录'}${e.source ? `（${e.source.name} 第 ${e.source.page} 页）` : ''}${e.fileId ? ` [附件](/api/files/${e.fileId})` : ''}`).join('\n') : '本次课堂未添加记录。') + '\n\n## 待确认疑问\n' + (events.filter(e => e.type === '疑问').map(e => '- ' + e.text).join('\n') || '尚未标记疑问。') + '\n\n以上为本地时间轴整理。需要知识总结或双语卡片时，可在学习模式中运行工具流程。';
        const note = addNote({ courseId: session.courseId, title: session.title + ' · 课堂笔记', content, sessionId: session.id, tags: ['课堂'] });
        store.put('sessions', { ...session, endedAt: new Date().toISOString(), noteId: note.id });
        if (preferences().mode === 'classroom') store.put('settings', { ...preferences(), mode: 'study' });
        return json(200, entity('sessions', session.id));
      }
      if (req.method === 'POST' && path === '/api/media') {
        ensure(preferences().mode !== 'exam', '考试模式禁止录音和截图。', 403);
        const mime = str(body.mime, 80).split(';')[0];
        ensure(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'image/png', 'image/jpeg', 'image/webp'].includes(mime), '媒体类型不支持。');
        ensure(typeof body.data === 'string', '媒体数据缺失。');
        const buffer = Buffer.from(body.data, 'base64');
        ensure(buffer.length && buffer.length <= MAX_FILE_BYTES, '媒体文件应小于 20 MB。');
        return json(201, saveFile(buffer, str(body.name, 200) || 'recording', mime));
      }
      if (req.method === 'POST' && path === '/api/transcribe') {
        checkPermissions(['ocr'], preferences());
        ensure(config.AI_API_KEY && config.AI_TRANSCRIBE_MODEL, '请配置 AI_TRANSCRIBE_MODEL。');
        const event = entity('events', body.eventId);
        if (event.transcribedAt) return json(200, event);
        const file = entity('files', event.fileId);
        ensure(file.mime.startsWith('audio/'), '该附件不是录音。');
        const form = new FormData(); form.append('file', new Blob([readFileSync(join(uploads, file.id))], { type: file.mime }), file.name); form.append('model', config.AI_TRANSCRIBE_MODEL);
        const response = await fetch(`${(config.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${config.AI_API_KEY}` }, body: form, signal: AbortSignal.timeout(120000) });
        ensure(response.ok, `语音服务返回 ${response.status}。`);
        const result = await response.json(); checkPermissions(['ocr'], preferences());
        ensure(typeof result.text === 'string', '未返回转写文本。');
        const updated = store.put('events', { ...event, text: str(result.text, 10000), transcribedAt: new Date().toISOString() });
        const session = entity('sessions', event.sessionId);
        if (session.noteId) {
          const note = entity('notes', session.noteId);
          store.put('notes', { ...note, content: note.content + `\n\n## 录音转写补充（${Math.floor(event.offsetMs / 60000)} 分钟处）\n${updated.text}`, updatedAt: new Date().toISOString() });
        }
        return json(200, updated);
      }
      if (req.method === 'POST' && path === '/api/workflows') {
        ensure(str(body.name, 80), '请给流程命名。');
        return json(201, store.add('workflows', { name: str(body.name, 80), description: str(body.description, 300), steps: validateSteps(body.steps), version: 1 }));
      }
      if (req.method === 'PATCH' && /^\/api\/cards\/[^/]+$/.test(path)) {
        guardWrite();
        const card = entity('cards', path.split('/').at(-1));
        ensure(str(body.question, 2000) && str(body.answer, 8000), '请输入问题和答案。');
        return json(200, store.put('cards', { ...card, question: str(body.question, 2000), answer: str(body.answer, 8000), updatedAt: new Date().toISOString() }));
      }
      if (req.method === 'DELETE' && /^\/api\/cards\/[^/]+$/.test(path)) {
        guardWrite();
        const id = path.split('/').at(-1);
        entity('cards', id);
        const result = store.transaction(() => removal.removeCard(id));
        console.log('[delete] cards', id, auth.owner);
        return json(200, result);
      }
      if (req.method === 'DELETE' && path.startsWith('/api/notes/')) {
        guardWrite();
        const id = path.slice('/api/notes/'.length);
        entity('notes', id);
        const result = store.transaction(() => removal.removeNote(id));
        console.log('[delete] notes', id, auth.owner);
        return json(200, result);
      }
      if (req.method === 'PATCH' && path.startsWith('/api/workflows/')) {
        guardWrite();
        const workflow = entity('workflows', path.slice('/api/workflows/'.length));
        if (body.name !== undefined) ensure(str(body.name, 80), '请给流程命名。');
        return json(200, store.put('workflows', {
          ...workflow,
          name: body.name === undefined ? workflow.name : str(body.name, 80),
          description: body.description === undefined ? workflow.description : str(body.description, 300),
          steps: body.steps === undefined ? workflow.steps : validateSteps(body.steps),
          version: (workflow.version || 1) + 1,
        }));
      }
      if (req.method === 'DELETE' && path.startsWith('/api/workflows/')) {
        guardWrite();
        const id = path.slice('/api/workflows/'.length);
        entity('workflows', id);
        const result = store.transaction(() => removal.removeWorkflow(id));
        console.log('[delete] workflows', id, auth.owner);
        return json(200, result);
      }
      if (req.method === 'DELETE' && path.startsWith('/api/documents/')) {
        requireAdmin(auth);
        guardWrite();
        const id = path.slice('/api/documents/'.length);
        const refs = url.searchParams.get('refs') || 'block';
        ensure(['block', 'detach', 'cascade'].includes(refs), 'refs 取值无效。', 400);
        entity('documents', id);
        ensure(!store.all('jobs').some(j => ['queued', 'running'].includes(j.status) && j.payload?.source?.documentId === id), '该资料正被电脑任务使用，请稍后再试。', 409);
        const { counts } = removal.referencedBy(id);
        if (refs === 'block' && (counts.notes + counts.runs + counts.events)) return json(409, { error: `该资料被 ${counts.notes} 篇笔记、${counts.runs} 条运行记录、${counts.events} 条课堂记录引用。`, counts });
        const result = store.transaction(() => removal.removeDocument(id, refs));
        console.log('[delete] documents', id, auth.owner);
        return json(200, result);
      }
      if (req.method === 'DELETE' && path.startsWith('/api/courses/')) {
        requireAdmin(auth);
        guardWrite();
        const id = path.slice('/api/courses/'.length);
        entity('courses', id);
        ensure(store.all('courses').length > 1, '至少保留一门课程。');
        const cascade = url.searchParams.get('cascade') === 'true';
        const target = url.searchParams.get('target') || '';
        ensure(!(cascade && target), '不能同时使用 cascade 与 target。');
        if (target) entity('courses', target);
        if (!cascade && !target) {
          const counts = removal.courseContent(id);
          if (Object.values(counts).some(n => n > 0)) return json(409, { error: '该课程下仍有资料、笔记或课堂记录，请选择迁移到其它课程或一并删除。', counts });
        }
        const result = store.transaction(() => removal.removeCourse(id, { cascade, target: target || undefined }));
        console.log('[delete] courses', id, auth.owner);
        return json(200, result);
      }
      if (req.method === 'DELETE' && path === '/api/runs') {
        guardWrite();
        const courseId = url.searchParams.get('courseId') || '';
        const status = url.searchParams.get('status') || 'done';
        const targets = store.all('runs').filter(r => (!courseId || r.courseId === courseId) && r.status === status);
        const result = store.transaction(() => targets.map(run => removal.removeRun(run.id)));
        console.log('[delete] runs', targets.length, auth.owner);
        return json(200, { ok: true, removed: result.filter(item => item.ok).length });
      }
      if (req.method === 'DELETE' && path.startsWith('/api/runs/')) {
        guardWrite();
        const id = path.slice('/api/runs/'.length);
        entity('runs', id);
        const result = store.transaction(() => removal.removeRun(id));
        console.log('[delete] runs', id, auth.owner);
        return json(200, result);
      }
      if (req.method === 'POST' && path === '/api/run') return json(200, publicRun(await runWorkflow(body)));
      if (path.startsWith('/api/')) return json(404, { error: '接口不存在。' });
      ensure(req.method === 'GET' || req.method === 'HEAD', '请求方法不支持。', 405);
      let filename;
      if (path === '/vendor/pdf.mjs' || path === '/vendor/pdf.worker.mjs') filename = join(root, 'node_modules/pdfjs-dist/build', path.split('/').at(-1));
      else {
        filename = resolve(root, 'public', '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
        ensure(filename.startsWith(join(root, 'public') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')), '路径不允许。', 403);
      }
      ensure(existsSync(filename), '文件不存在。', 404);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
      res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(filename));
    } catch (error) { if (!res.headersSent) json(error.status || 400, { error: error.message || '请求失败。' }); else res.end(); }
  };
  const server = http.createServer((req, res) => handle(req, res, 'local'));
  const remoteServer = control ? http.createServer((req, res) => handle(req, res, 'remote')) : null;
  server.requestTimeout = 150000;
  if (remoteServer) remoteServer.requestTimeout = 150000;
  return { server, remoteServer, store, closeJobs: mobile.close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (!process.env.ACCESS_TOKEN || !/^[A-Za-z0-9_-]{16,128}$/.test(process.env.ACCESS_TOKEN))) throw new Error('局域网监听需要设置 16–128 位字母、数字或下划线组成的 ACCESS_TOKEN。');
  const { server, store, closeJobs } = createApp();
  server.listen(Number(process.env.PORT || 4317), host, () => console.log(`拾知学习助手：http://${host}:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await closeJobs(); store.close(); process.exit(0); }));
}
