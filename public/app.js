import { request, newId, nativeCall } from './transport.js';
import { initSync, entries, snapshot, queueOperation, queueUpload, queueJob, flush, retryEntry, cancelEntry, discardEntry, preserveConflict, overlay } from './sync.js';
import { toolState, toolWorkspace, toolAction, calculatorKey, toolLabels, decorateWords } from './tool-views.js';
const $ = (s, root = document) => root?.querySelector(s);
const $$ = (s, root = document) => [...(root?.querySelectorAll(s) || [])];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const noteMarkup = value => escape(value).replace(/\[([^\]\n]+)\]\((\/api\/files\/[0-9a-f-]{36})\)/g,
  `<a href="$2"${window.StudyNative ? '' : ' target="_blank"'} rel="noopener">$1 ↗</a>`);
const icons = {
  home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  book:'M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-3-1-6-2-10 1Zm0 0v16',
  notebook:'M6 3h13v18H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v18M11 8h5M11 12h5',
  clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  grid:'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
  tool:'M5 6h14M5 12h14M5 18h14M9 4v4M15 10v4M9 16v4',
  cards:'M6 7h15v14H6ZM3 17V3h14M10 12h7M10 16h4',
  plus:'M12 5v14M5 12h14', chevron:'m9 5 7 7-7 7', back:'m15 5-7 7 7 7',
  upload:'M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6', download:'M12 3v13m-5-5 5 5 5-5M3 17v4h18v-4',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  sparkles:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4',
  scan:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 12h18',
  languages:'M3 5h12M9 2v3M6 5c0 7 6 10 6 10M12 5c0 7-7 11-9 11m10 5 5-12 5 12m-8-4h6',
  list:'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1',
  code:'m8 5-7 7 7 7m8-14 7 7-7 7M14 3l-4 18',
  calculator:'M5 2h14v20H5ZM8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-2-6h4l1 3 3 1 3 2-1 4 1 4-3 2-3 1-1 3h-4l-1-3-3-1-3-2 1-4-1-4 3-2 3-1Z',
  leaf:'M20 3C7 1 1 8 5 17c9 5 17-1 15-14ZM5 19l10-10',
  close:'m6 6 12 12M6 18 18 6', send:'m21 3-7 18-4-7-7-4Zm0 0L10 14',
  check:'m5 12 4 4L20 5', mic:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0Zm-3 6v1a6 6 0 0 0 12 0v-1M12 18v4m-4 0h8',
  camera:'M3 6h4l2-3h6l2 3h4v15H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  flag:'M5 22V3c5-4 9 4 15 0v10c-6 4-10-4-15 0', help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 3h.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  play:'m8 4 13 8-13 8Z', stop:'M5 5h14v14H5Z', link:'m9 15 6-6m-7 3-3 3a4 4 0 0 0 6 6l3-3m-4-8 3-3a4 4 0 0 1 6 6l-3 3',
  shield:'m12 2 9 4v7c0 5-9 9-9 9s-9-4-9-9V6Zm-5 10 3 3 7-7', file:'M5 2h9l5 5v15H5Zm9 0v6h5M8 12h8m-8 4h8',
};
const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.file}"/></svg>`;
const button = (label, action, opts = '') => `<button class="btn ${opts}" data-action="${action}">${label}</button>`;
const fmtDate = v => new Date(v).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const elapsed = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const state = { data: null, view: 'home', courseId: localStorage.getItem('study-course') || '', documentId: null, page: 1, selection: '', image: '', chat: [], query: '', tab: 'plugins', sessionId: null, busy: false, offline: false, flipped: false, floatShape: localStorage.getItem('study-float') || 'ball', wbTool: localStorage.getItem('study-wb-tool') || 'explain', wbInput: '', wbRequest: '', wbNoteTitle: '' };
let pdfCache = null, recording = null, recordStream = null, recordChunks = [], recordTimer, uploadBusy = false;
const overlayTools = { capture: '截图圈选', translate: '翻译', explain: '解释', summarize: '整理重点', cards: '复习卡片', formula: '公式识别与解释', code: '代码解释', dictionary: '词典', calculator: '计算器', note: '保存笔记' };
const pendingResults = new Set();
let overlayHandling = false;
function toolSteps(tool, hasImage) {
  if (tool === 'note') return [];
  const selected = tool === 'formula' || tool === 'capture' ? 'explain' : tool;
  return [...(hasImage ? ['ocr'] : []), selected];
}
const currentCourse = () => state.data.courses.find(c => c.id === state.courseId) || state.data.courses[0];
const currentDoc = () => state.data.documents.find(d => d.id === state.documentId);
const inCourse = items => items.filter(x => x.courseId === state.courseId);
const activeSession = () => state.data.sessions.find(s => !s.endedAt);
const currentSession = () => state.data.sessions.find(s => s.id === state.sessionId) || activeSession() || inCourse(state.data.sessions)[0];
const dueCards = () => inCourse(state.data.cards).filter(c => new Date(c.dueAt).getTime() <= Date.now());
// 离线新建、又在离线状态删除时，创建操作还没上传：直接撤掉它，避免同步时产生无意义的版本冲突。
async function dropUnsyncedCreate(kind, entityId) {
  const pending = (await entries()).find(e => e.type === 'operation' && e.status === 'pending' && e.operation.kind === kind && e.operation.entityId === entityId);
  if (!pending) return false;
  await discardEntry(pending.id);
  toast('已撤销尚未上传的新建操作。');
  return true;
}
const api = async (path, body, method = 'POST') => {
  let kind, entityId, payload = { ...body }, dependency;
  if (body !== undefined && state.data?.connection) {
    if (path === '/notes') kind = 'note.create';
    else if (method === 'PATCH' && path.startsWith('/notes/')) { kind = 'note.update'; entityId = path.split('/').at(-1); payload.baseUpdatedAt = state.data.notes.find(n => n.id === entityId)?.updatedAt; }
    else if (path === '/cards') kind = 'card.create';
    else if (/^\/cards\/[^/]+\/review$/.test(path)) { kind = 'card.review'; entityId = path.split('/')[2]; payload.baseReviews = state.data.cards.find(c => c.id === entityId)?.reviews; }
    else if (method === 'DELETE' && path.startsWith('/notes/')) { entityId = path.split('/').at(-1); if (await dropUnsyncedCreate('note.create', entityId)) { await refresh(false); return { ok: true, id: entityId, cancelled: true }; } kind = 'note.delete'; const note = state.data.notes.find(n => n.id === entityId); payload.baseUpdatedAt = note?.updatedAt; payload.title = note?.title || ''; }
    else if (method === 'PATCH' && /^\/cards\/[^/]+$/.test(path)) { kind = 'card.update'; entityId = path.split('/')[2]; payload.baseReviews = state.data.cards.find(c => c.id === entityId)?.reviews; }
    else if (method === 'DELETE' && /^\/cards\/[^/]+$/.test(path)) { entityId = path.split('/')[2]; if (await dropUnsyncedCreate('card.create', entityId)) { await refresh(false); return { ok: true, id: entityId, cancelled: true }; } kind = 'card.delete'; payload.baseReviews = state.data.cards.find(c => c.id === entityId)?.reviews; }
    else if (path === '/sessions') { kind = 'session.start'; payload.startedAt = new Date().toISOString(); }
    else if (/^\/sessions\/[^/]+\/events$/.test(path)) { kind = 'event.create'; payload.sessionId = path.split('/')[2]; payload.capturedAt ||= new Date().toISOString(); }
    else if (/^\/sessions\/[^/]+\/end$/.test(path)) { kind = 'session.end'; entityId = path.split('/')[2]; payload.endedAt = new Date().toISOString(); }
    if (kind) {
      if (payload.fileId?.startsWith('pending:')) { dependency = payload.fileId.slice(8); delete payload.fileId; }
      const attachment = payload.content?.match(/\/api\/files\/pending:([a-f0-9-]{36})/); if (attachment) dependency = attachment[1];
      const op = await queueOperation(kind, payload, entityId, dependency);
      if (!state.offline) await flush();
      const updated = (await entries()).find(e => e.id === op.id);
      await refresh(false);
      if (updated.status === 'blocked') toast('已保留本机版本：' + updated.error);
      return updated.result || { ...payload, id: op.operation.entityId, pending: true };
    }
    if (path === '/media') {
      const bytes = Uint8Array.from(atob(body.data), c => c.charCodeAt(0));
      const entry = await queueUpload(new Blob([bytes], { type: body.mime }), { kind: 'media', mime: body.mime, name: body.name });
      if (!state.offline) await flush();
      const updated = (await entries()).find(e => e.id === entry.id);
      return updated.result || { id: 'pending:' + entry.id, pending: true };
    }
  }
  return request(path, body, body === undefined ? 'GET' : method);
};
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 4200); }
async function refresh(renderNow = true) {
  try {
    const fresh = await request('/bootstrap');
    await initSync(fresh.connection.serverId, syncChanged); await snapshot(fresh);
    state.data = overlay(fresh, await entries()); state.offline = false;
    if (window.StudyNative) await nativeCall('setContext', { mode: state.data.preferences.mode, courseId: state.courseId });
  } catch (error) {
    if (error.status === 401) throw error;
    const cached = await snapshot(); if (!cached) throw error;
    state.data = overlay(cached, await entries()); state.offline = true;
  }
  if (!state.data.courses.some(c => c.id === state.courseId)) state.courseId = state.data.courses[0]?.id;
  // Opt-in private note snapshot, never API keys or uploads.
  if (localStorage.getItem('study-offline-enabled') === 'true') {
    try { localStorage.setItem('study-snapshot', JSON.stringify({ ...state.data, documents: [], runs: [], events: [], sessions: [], savedAt: new Date().toISOString() })); } catch { toast('设备存储空间不足，离线快照未更新。'); }
  }
  if (renderNow) render();
}
function openModal(title, content, wide = false) {
  const prior = document.activeElement;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header><h2 id="dialog-title">${escape(title)}</h2><button class="icon-btn" data-action="close-modal" aria-label="关闭">${icon('close')}</button></header><div class="modal-content">${content}</div></section></div>`;
  openModal.prior = prior;
  setTimeout(() => $('input,textarea,button', $('.modal-content'))?.focus(), 30);
}
function closeModal() { $('#modal-root').innerHTML = ''; openModal.prior?.focus(); }
function empty(text, detail = '', action = '') { return `<div class="empty">${icon('leaf')}<div>${text}</div><p>${detail}</p>${action}</div>`; }
function courseSelect() { return `<select class="select" id="course-select" aria-label="选择课程">${state.data.courses.map(c => `<option value="${c.id}" ${c.id === state.courseId ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}</select>`; }
function searchBar(placeholder) { return `<label class="search">${icon('search')}<input id="search" placeholder="${placeholder}" value="${escape(state.query)}" aria-label="${placeholder}"></label>`; }
const viewTitles = { home: '学习空间', library: '课程资料', reader: '课件阅读', classroom: '课堂时间轴', notes: '我的笔记', review: '复习卡片', workbench: '工作台', plugins: '工具调度台', settings: '偏好设置' };
function heading(title, subtitle, action = '') { return `<div class="page-heading"><div><div class="eyebrow">STUDY COMPANION / 拾知</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`; }
function render() {
  if (!state.data) return;
  const d = state.data;
  const nav = [['home', 'home', '学习空间'], ['library', 'book', '课程资料'], ['classroom', 'clock', '课堂记录'], ['notes', 'notebook', '我的笔记'], ['review', 'cards', '复习卡片'], ['workbench', 'tool', '工作台'], ['plugins', 'grid', '工具调度']];
  $('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/icon.svg" alt=""><div><strong>拾知</strong><small>STUDY COMPANION</small></div></div><nav class="nav" aria-label="主导航">${nav.map(([id, glyph, label]) => `<button data-nav="${id}" class="${state.view === id || (state.view === 'reader' && id === 'library') ? 'active' : ''}">${icon(glyph)}<span>${label}</span>${id === 'review' && dueCards().length ? `<span class="count">${dueCards().length}</span>` : ''}</button>`).join('')}</nav><div class="course-list"><div class="side-label">我的课程</div>${d.courses.slice(0, 5).map(c => `<button data-course="${c.id}" class="${c.id === state.courseId ? 'selected' : ''}"><span class="dot"></span><span class="truncate">${escape(c.name)}</span></button>`).join('')}<button data-action="new-course">${icon('plus')} 添加课程</button></div><div class="side-bottom">${icon('leaf')} 留一点空间给思考<p>随手记录，慢慢理解。<br>每个知识点，都值得被拾起。</p><span class="pill">${icon('shield')} 本地保存</span></div><button class="side-settings" data-nav="settings">${icon('settings')} 偏好与权限</button></aside><main class="main"><header class="topbar"><div class="breadcrumb">我的工作台 <span>/</span> <strong>${viewTitles[state.view]}</strong></div><button class="mobile-brand" data-nav="home"><img src="/icon.svg" alt="">拾知</button><div class="top-actions"><span class="pill"><span class="dot"></span>${d.model.configured ? escape(d.model.name) : '本地学习空间'}</span><select id="mode-select" class="mode-select" aria-label="学习模式"><option value="study" ${d.preferences.mode === 'study' ? 'selected' : ''}>专注学习</option><option value="classroom" ${d.preferences.mode === 'classroom' ? 'selected' : ''}>课堂 · 只记录</option><option value="exam" ${d.preferences.mode === 'exam' ? 'selected' : ''}>考试 · 限制工具</option></select><button class="icon-btn" data-nav="settings" aria-label="设置">${icon('settings')}</button><div class="avatar">知</div></div></header>${state.offline ? '<div class="offline-banner">正在查看此设备保存的笔记快照。服务未连接，编辑和工具暂不可用。</div>' : ''}${d.preferences.mode === 'exam' ? '<div class="offline-banner">考试模式：仅查看离线笔记与内置词典。可用范围仍须遵守考试具体要求。</div>' : ''}<div class="content">${({ home: homeView, library: libraryView, reader: readerView, classroom: classroomView, notes: notesView, review: reviewView, workbench: workbenchView, plugins: pluginsView, settings: settingsView })[state.view]()}</div></main></div>${d.preferences.mode === 'exam' ? '' : `<button class="floating ${state.floatShape}" data-action="quick-capture" aria-label="唤出学习助手" title="唤出学习助手（Alt+Q）">${icon(d.preferences.mode === 'classroom' ? 'plus' : 'sparkles')}${state.floatShape !== 'ball' ? '<span>随手记</span>' : ''}</button>`}`;
  if (state.view === 'reader') mountReader().catch(e => toast(e.message));
  if (window.StudyNative && state.view === 'classroom') {
    const recordButton = $('.record-tools [data-action="record"]');
    if (recordButton) recordButton.innerHTML = icon('mic') + ' 管理录音';
    const hint = $('.timeline-layout aside .hint:last-child');
    if (hint) hint.textContent = 'Android 端使用通知栏前台录音服务，每段最多 4 分钟；关闭页面后可继续，系统强制终止应用时当前片段可能丢失。请取得课堂所需的录音同意。';
  }
  if (state.view === 'settings') $('.settings-panel')?.insertAdjacentHTML('afterbegin', `${state.data.control?.available && state.data.connection?.admin && !window.StudyNative ? `<div class="setting-row"><div><h3>电脑服务控制台</h3><p>管理手机接入和 Tailscale 异网连接；关闭后台服务后可用“启动拾知.cmd”重新打开。</p></div>${button('打开服务控制台', 'service-center')}</div>` : ''}<div class="setting-row"><div><h3>手机与电脑 · 同步中心</h3><p>${escape(state.data.connection?.name || '电脑工作站')} · ${state.offline ? '当前离线，可继续记录，等待同步' : '已连接'}<br>笔记、录音和文件先保存在本机，恢复连接后发送。</p></div>${button('连接与进度', 'connection-center')}</div>${window.StudyNative ? `<div class="setting-row"><div><h3>Android 原生能力</h3><p>授权截图、悬浮入口、前台录音及系统分享导入。</p></div>${button('原生工具', 'native-tools')}</div>` : ''}`);
  if (state.offline) { const banner = $('.offline-banner'); if (banner) banner.textContent = '电脑暂未连接。可继续记笔记、创建卡片和课堂记录，内容保存在本机待同步队列。'; }
}
function homeView() {
  const d = state.data, docs = inCourse(d.documents);
  return heading('让每一次理解，都有迹可循。', '你的课件、灵感和知识，在这里慢慢连成线。', button(icon('plus') + ' 导入课件', 'import', 'primary')) + `<section class="hero"><div><div class="eyebrow">LESS EFFORT, MORE UNDERSTANDING</div><h2>专注眼前的知识，<br>其余的，交给拾知。</h2><p>圈选不懂的地方，让翻译、解释与笔记自然发生。</p>${button('开始一次学习 ' + icon('chevron'), 'go-library')}</div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><div class="book-art"><span></span><span></span><span></span><span></span></div><div class="art-label a">${icon('languages')} 读懂一个新概念</div><div class="art-label b">${icon('check')} 已收进你的知识库</div></div></section><div class="stats">${[['book', docs.length, '份课程资料'], ['notebook', inCourse(d.notes).length, '篇知识笔记'], ['cards', dueCards().length, '张待复习卡片'], ['clock', inCourse(d.sessions).length, '次课堂记录']].map(([i, n, t]) => `<div class="stat"><div class="stat-icon">${icon(i)}</div><div><strong>${n}</strong><small>${t}</small></div></div>`).join('')}</div><div class="home-grid"><section><div class="section-heading"><h2>继续学习</h2><button class="muted" data-action="new-course"><small>添加课程 +</small></button></div>${d.courses.slice(0, 3).map(c => `<button class="course-card" data-course="${c.id}"><span class="tag">我的课程</span><h3>${escape(c.name)}</h3><div class="course-meta"><span>${d.documents.filter(x => x.courseId === c.id).length} 份课件</span><span>${d.notes.filter(x => x.courseId === c.id).length} 篇笔记</span><span>${d.cards.filter(x => x.courseId === c.id).length} 张卡片</span></div><div class="course-foot"><span>${c.id === state.courseId ? '当前正在学习' : '开启学习空间'}</span>${icon('chevron')}</div></button>`).join('')}<div class="section-heading section-spacer"><h2>最近拾起的知识</h2><button data-nav="notes"><small>全部笔记 →</small></button></div><div class="panel pad">${inCourse(d.notes).length ? inCourse(d.notes).slice(0, 3).map(n => `<button class="list-row full" data-note="${n.id}"><div class="file-icon">${icon('notebook')}</div><div><h3 class="truncate">${escape(n.title)}</h3><p>${fmtDate(n.createdAt)} · ${escape(n.tags?.[0] || '学习笔记')}</p></div>${icon('chevron')}</button>`).join('') : empty('知识从一次随手记录开始', '导入课件，或者先写下今天的第一个疑问。', button('写一篇笔记', 'new-note', 'small'))}</div></section><aside><div class="section-heading"><h2>轻轻一步，进入状态</h2></div><div class="panel pad"><h3>把重复的事，连成一个流程</h3><p class="hint">选好材料，一次完成理解与整理。</p>${d.defaultWorkflows.map(w => `<button class="mini-workflow" data-workflow="${w.id}">${icon(w.steps[0] === 'ocr' ? 'scan' : w.steps[0] === 'cards' ? 'cards' : 'languages')}<span><strong>${escape(w.name)}</strong><small>${w.steps.map(s => d.plugins.find(p => p.id === s).name).join(' → ')}</small></span></button>`).join('')}</div><div class="section-heading section-spacer"><h2>最近的课件</h2><button data-nav="library"><small>查看全部 →</small></button></div><div class="panel pad">${docs.length ? docs.slice(0, 3).map(docRow).join('') : empty('还没有导入课件', '支持 PDF、PPTX、图片与文字。', button('体验示例课件', 'demo', 'small'))}</div></aside></div>`;
}
function docRow(d) { return `<button class="list-row full" data-doc="${d.id}"><div class="file-icon ${d.type}">${d.type.toUpperCase().slice(0, 4)}</div><div><h3 class="truncate">${escape(d.name)}</h3><p>${d.pages.length} 页 · ${fmtDate(d.createdAt)}</p></div>${icon('chevron')}</button>`; }
function libraryView() {
  const docs = inCourse(state.data.documents).filter(d => d.name.toLowerCase().includes(state.query.toLowerCase()));
  return heading('课程资料', '把散落的课件，收进同一个学习空间。', button(icon('upload') + ' 导入课件', 'import', 'primary')) + `<div class="toolbar">${searchBar('搜索课件名称')}${courseSelect()}${button(icon('plus') + ' 新课程', 'new-course', 'small')}</div><button class="upload-zone full" id="drop-zone" data-action="import">${icon('upload')}<span>拖入文件，或点此导入课件<br><small>PDF · PPTX · 图片 · TXT · Markdown / 最大 20 MB</small></span></button>${docs.length ? `<div class="library-grid">${docs.map(d => `<button class="doc-card" data-doc="${d.id}"><div class="doc-card-top"><div class="file-icon ${d.type}">${d.type.toUpperCase().slice(0, 4)}</div>${icon('chevron')}</div><h3 class="truncate">${escape(d.name)}</h3><p>${d.pages.length} 页 · ${(d.bytes / 1024).toFixed(0)} KB</p><p>${fmtDate(d.createdAt)} 加入</p></button>`).join('')}</div>` : empty(state.query ? '没有找到匹配的课件' : '第一份课件，就是起点', '导入后可以逐页阅读、圈选提问并追溯笔记来源。', button('体验示例课件', 'demo'))}`;
}
function readerView() {
  const doc = currentDoc(); if (!doc) return empty('请先选择一份课件', '', button('回到课程资料', 'go-library'));
  const page = doc.pages[state.page - 1];
  return `<button class="breadcrumbs-back" data-nav="library">${icon('back')} 课程资料 / ${escape(currentCourse().name)}</button><div class="reader-layout"><section class="panel"><div class="reader-head"><h3 class="truncate">${escape(doc.name)}</h3><div class="row">${button('选中文字提问', 'use-selection', 'small')}${button(icon('flag'), 'mark-page', 'small')}</div></div><div class="reader-page"><div class="page-number">PAGE ${String(state.page).padStart(2, '0')} / ${String(doc.pages.length).padStart(2, '0')}</div>${doc.type === 'pdf' ? '<div id="canvas-wrap" class="canvas-wrap"><canvas id="pdf-canvas"></canvas></div><p class="hint">拖动框选页面区域；文字也可在下方选中后提问。</p>' : doc.type === 'image' ? `<div id="canvas-wrap" class="canvas-wrap"><img id="source-image" src="/api/files/${doc.fileId}" alt="${escape(doc.name)}"></div><p class="hint">用手指、手写笔或鼠标拖动框选。</p>` : ''}<div id="document-text" class="document-text">${escape(page.text)}</div>${doc.warning ? `<div class="notice">${escape(doc.warning)}</div>` : ''}</div><div class="reader-foot"><button data-action="prev-page" ${state.page <= 1 ? 'disabled' : ''} aria-label="上一页">${icon('back')}</button>第 ${state.page} / ${doc.pages.length} 页<button data-action="next-page" ${state.page >= doc.pages.length ? 'disabled' : ''} aria-label="下一页">${icon('chevron')}</button></div></section>${assistantView()}</div>`;
}
function assistantView() {
  const d = state.data, doc = currentDoc();
  return `<aside class="assistant-panel"><div class="assistant-title">${icon('sparkles')} 拾知学习助手 <span class="pill" style="margin-left:auto">${d.preferences.mode === 'classroom' ? '安静记录' : '随选随问'}</span></div><div class="assistant-body">${state.selection || state.image ? `<div class="context-box">${state.image ? `<img src="${state.image}" alt="已圈选的内容">` : escape(state.selection.slice(0, 1000))}</div>` : `<p>${doc ? '选中左侧文字或圈选图片。未选择时，使用当前页文字。' : '粘贴一段学习材料，或导入截图开始。'}</p>`}<div class="quick-actions">${[['languages', '翻译', 'translate'], ['sparkles', '解释', 'explain'], ['list', '整理重点', 'summarize'], ['cards', '复习卡片', 'cards']].map(([i, n, s]) => `<button class="btn" data-tool="${s}" ${state.busy ? 'disabled' : ''}>${icon(i)}${n}</button>`).join('')}</div><div class="chat-log">${state.chat.map(m => `<div class="chat-message ${m.role === 'user' ? 'user' : ''}">${escape(m.content)}</div>`).join('')}${state.busy ? '<div class="row hint"><span class="busy-dot"></span>工具运行中，完成后将显示结果…</div>' : ''}</div><div class="chat-input"><textarea class="field" id="chat-request" placeholder="例如：翻译并总结考点，保存到笔记" aria-label="向学习助手提问"></textarea><button class="chat-send" data-action="ask" ${state.busy ? 'disabled' : ''} aria-label="发送问题">${icon('send')}</button></div><div class="row" style="margin-top:12px">${button(icon('notebook') + ' 保存选区', 'save-selection', 'small')}${button(icon('camera') + ' 导入截图', 'capture-file', 'small')}</div><p class="hint">${d.preferences.autoSave ? '问答结果自动记入当前课程。' : '自动保存已关闭。'}${!d.model.configured ? ' AI 功能需在 .env 配置模型。' : ''}</p></div></aside>`;
}
let renderGeneration = 0;
async function mountReader() {
  const generation = ++renderGeneration, doc = currentDoc();
  if (!doc) return;
  if (doc.type === 'pdf') {
    const pdfjs = await import('/vendor/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    if (!pdfCache || pdfCache.id !== doc.id) { if (pdfCache) await pdfCache.task.destroy(); const task = pdfjs.getDocument({ url: `/api/files/${doc.fileId}`, isEvalSupported: false }); pdfCache = { id: doc.id, task, pdf: await task.promise }; }
    const page = await pdfCache.pdf.getPage(state.page);
    if (generation !== renderGeneration || state.view !== 'reader') return;
    const canvas = $('#pdf-canvas'); if (!canvas) return;
    const viewport = page.getViewport({ scale: Math.min(2, 1400 / page.getViewport({ scale: 1 }).width) });
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
  const wrap = $('#canvas-wrap'); if (wrap) attachCrop(wrap, async cropped => { state.image = cropped; state.selection = ''; renderAssistant(); toast('已圈选，可提问或保存。'); });
}
function attachCrop(wrap, onCrop) {
  let start = null, box;
  const point = e => { const r = wrap.getBoundingClientRect(); return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) }; };
  wrap.onpointerdown = e => { if (e.button !== 0) return; start = point(e); wrap.setPointerCapture(e.pointerId); box = document.createElement('div'); box.className = 'selection-box'; wrap.append(box); e.preventDefault(); };
  wrap.onpointermove = e => { if (!start) return; const p = point(e); Object.assign(box.style, { left: Math.min(start.x, p.x) + 'px', top: Math.min(start.y, p.y) + 'px', width: Math.abs(p.x - start.x) + 'px', height: Math.abs(p.y - start.y) + 'px' }); };
  wrap.onpointerup = e => {
    if (!start) return; const end = point(e), initial = start; start = null; box?.remove();
    const w = Math.abs(end.x - initial.x), h = Math.abs(end.y - initial.y); if (w < 8 || h < 8) return;
    const source = $('canvas,img', wrap), r = wrap.getBoundingClientRect();
    const ratio = (source.naturalWidth || source.width) / r.width;
    onCrop(encodeCrop(source, Math.min(initial.x, end.x) * ratio, Math.min(initial.y, end.y) * ratio, w * ratio, h * ratio));
  };
  wrap.onpointercancel = () => { start = null; box?.remove(); };
}
function encodeCrop(source, x, y, width, height) {
  const canvas = document.createElement('canvas');
  const renderAt = scale => {
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
  };
  const underLimit = data => (data.length - data.indexOf(',') - 1) * .75 <= 8 * 1024 * 1024;
  renderAt(1);
  let data = canvas.toDataURL('image/png');
  if (underLimit(data)) return data;
  let scale = Math.min(1, 3200 / Math.max(width, height));
  if (scale < 1) renderAt(scale);
  for (const quality of [.96, .92, .88, .84]) {
    data = canvas.toDataURL('image/jpeg', quality);
    if (underLimit(data)) return data;
  }
  while (!underLimit(data) && Math.max(canvas.width, canvas.height) > 800) {
    scale *= .8; renderAt(scale); data = canvas.toDataURL('image/jpeg', .88);
  }
  if (!underLimit(data)) throw new Error('选区过大，请缩小圈选范围。');
  return data;
}
function renderAssistant() { const panel = $('.assistant-panel'); if (panel) panel.outerHTML = assistantView(); }
function notesView() {
  const notes = inCourse(state.data.notes).filter(n => `${n.title} ${n.content}`.toLowerCase().includes(state.query.toLowerCase()));
  return heading('我的笔记', '那些被理解的片段，正在成为你的知识。', button(icon('plus') + ' 新建笔记', 'new-note', 'primary')) + `<div class="toolbar">${searchBar('搜索笔记与知识点')}${courseSelect()}${button(icon('download') + ' 导出课程', 'export-notes', 'small')}</div>${notes.length ? `<div class="note-grid">${notes.map(n => `<button class="note-card" data-note="${n.id}"><span class="pill">${escape(n.tags?.[0] || '学习笔记')}</span><h3>${escape(n.title)}</h3><p>${escape(n.content)}</p><footer>${icon('link')}${n.source ? escape(n.source.name) + ' · 第 ' + n.source.page + ' 页' : fmtDate(n.updatedAt || n.createdAt)}</footer></button>`).join('')}</div>` : empty(state.query ? '没有找到匹配的知识点' : '还没有笔记，先拾起一小段', '圈选内容、运行流程或结束课堂后，笔记会汇集在这里。')}`;
}
function reviewView() {
  const due = dueCards(), card = due[0], total = inCourse(state.data.cards).length;
  return heading('温故，才能知新。', `这门课共有 ${total} 张卡片，${due.length} 张等待今天的你。`, button(icon('plus') + ' 新建卡片', 'new-card')) + `<div class="toolbar">${courseSelect()}<span class="pill">${icon('cards')} 间隔复习</span></div>${card ? `<div class="review-card"><span class="eyebrow">RECALL BEFORE REVEAL / 先回忆，再翻面</span><div class="question">${escape(card.question)}</div>${state.flipped ? `<div class="answer">${escape(card.answer)}</div><p class="hint">你对这个知识点掌握得怎么样？</p><div class="review-controls">${button('还需练习 · 10 分钟', 'rate-again')}${button('记住了 · ' + Math.max(1, card.interval * 2) + ' 天', 'rate-good', 'primary')}${button('很轻松 · ' + Math.max(4, card.interval * 3) + ' 天', 'rate-easy')}</div>` : button('翻开答案', 'flip-card', 'primary')}<p class="hint">剩余 ${due.length} 张 · 已复习 ${card.reviews} 次</p></div>` : empty(total ? '今天的复习完成了' : '把知识变成可以回忆的问题', total ? '稍后到期的卡片会再次出现在这里。' : '手动创建卡片，或从课件运行「复习卡片」工具。', button('创建第一张卡片', 'new-card'))}`;
}
function classroomView() {
  const session = currentSession(), running = activeSession();
  const events = session ? state.data.events.filter(e => e.sessionId === session.id).sort((a, b) => b.offsetMs - a.offsetMs) : [];
  return heading('留在课堂，记录交给拾知。', '重点、疑问与板书，沿着时间慢慢对齐。', running ? button(icon('stop') + ' 结束课堂', 'end-session', 'primary') : button(icon('play') + ' 开始课堂', 'start-session', 'primary')) + `<div class="toolbar">${courseSelect()}<select class="select" id="session-select" aria-label="选择课堂"><option value="">最近的课堂</option>${inCourse(state.data.sessions).map(s => `<option value="${s.id}" ${s.id === session?.id ? 'selected' : ''}>${escape(s.title)} · ${fmtDate(s.startedAt)}</option>`).join('')}</select></div><div class="timeline-layout"><section>${session ? `<div class="session-banner"><div><h2>${escape(session.title)}</h2><p>${session.endedAt ? '已整理课堂笔记 · 随时回看' : '只记录，不弹出解答 · 数据保存在本地'}</p></div><span class="clock" id="session-clock" data-start="${session.startedAt}" data-end="${session.endedAt || ''}">${elapsed((session.endedAt ? Date.parse(session.endedAt) : Date.now()) - Date.parse(session.startedAt))}</span></div>` : ''}${session && !session.endedAt ? `<div class="record-tools">${button(icon('flag') + ' 标记重点', 'event-important')}${button(icon('help') + ' 记个疑问', 'event-question')}${button(icon('book') + ' 记页码', 'event-page')}${button(icon('camera') + ' 拍板书', 'event-photo')}${button(icon(recording ? 'stop' : 'mic') + (recording ? ' 停止录音' : ' 开始录音'), 'record', recording ? 'recording' : '')}</div>` : ''}${events.length ? `<div class="timeline">${events.map(e => `<article class="event"><header><time>${elapsed(e.offsetMs)}</time><span class="pill">${escape(e.type)}</span></header><p>${escape(e.text)}</p>${e.fileId ? e.type === '录音' ? `<audio controls src="/api/files/${e.fileId}"></audio>${state.data.model.transcription && session.endedAt ? `<div><button class="btn small" data-transcribe="${e.id}">转写这段录音</button></div>` : ''}` : `<img src="/api/files/${e.fileId}" alt="${escape(e.type)}">` : ''}${e.source ? `<button class="source" data-source="${e.source.documentId}" data-page="${e.source.page}">${escape(e.source.name)} · 第 ${e.source.page} 页 ↗</button>` : ''}</article>`).join('')}</div>` : empty(session ? '把注意力留给老师' : '准备好，开始一堂课', session ? '遇到重点就点一下，记录会按时间出现在这里。' : '开始后可标记重点、疑问、课件页码、照片和录音。')}${session?.noteId ? `<button class="btn" data-note="${session.noteId}">${icon('notebook')} 查看课后笔记</button>` : ''}</section><aside><div class="panel pad"><span class="pill">${icon('leaf')} 课堂模式</span><h3 style="margin-top:17px">安静地陪你上课</h3><p class="hint">只在你主动操作时记录，不自动读取屏幕，不弹出 AI 回答。</p><div class="notice green">课后自动合并时间轴与疑问。切回学习模式，可继续生成双语笔记、重点与复习卡片。</div><p class="hint">录音需要麦克风权限，每段最多 5 分钟。离开页面或关闭设备会中断录音；结束前请保存。请取得课堂所需的录音同意。</p></div></aside></div>`;
}
function pluginsView() {
  const d = state.data;
  return heading('一个想法，一串好用的工具。', '让识别、理解、整理自然衔接，减少重复操作。', button(icon('plus') + ' 创建流程', 'new-workflow', 'primary')) + `<div class="tab-row">${[['plugins', '已内置工具'], ['workflows', '我的工作流'], ['runs', '运行记录']].map(([id, label]) => `<button class="${state.tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}</div>${state.tab === 'plugins' ? `<div class="notice green">首版只运行内置工具与声明式流程。外部代码插件、审核评分和分成系统尚未开放。</div><div class="plugin-grid">${d.plugins.map(p => `<article class="plugin-card"><div class="plugin-top"><div class="plugin-logo">${icon(p.icon)}</div><button class="toggle ${d.preferences.disabledPlugins.includes(p.id) ? '' : 'on'}" role="switch" aria-checked="${!d.preferences.disabledPlugins.includes(p.id)}" aria-label="启用${p.name}" data-toggle-plugin="${p.id}"></button></div><h3>${p.name}</h3><p>${p.description}</p><div class="permissions">${(p.permissions.length ? p.permissions : ['local']).map(s => `<span>${({ network: '网络 · 所选内容', notes: '笔记写入', selection: '圈选图像', local: '本地运行' })[s]}</span>`).join('')}</div><button class="btn small full" data-plugin-use="${p.id}">${p.online && !d.model.configured ? '配置模型后使用' : '使用工具'}</button></article>`).join('')}</div>` : state.tab === 'workflows' ? `<div class="toolbar">${button(icon('upload') + ' 导入流程 JSON', 'import-workflow', 'small')}<small>可分享工具组合，不包含密钥和学习资料。</small></div>${[...d.defaultWorkflows, ...d.workflows].map(w => `<article class="workflow-card"><div class="spread"><h3>${escape(w.name)}</h3><span class="pill">${w.createdAt ? '自定义' : '内置流程'}</span></div><p>${escape(w.description)}</p><div class="workflow-steps">${w.steps.map((s, i) => `${i ? '→' : ''}<span>${d.plugins.find(p => p.id === s)?.name || escape(s)}</span>`).join('')}</div><div class="row"><button class="btn small primary" data-workflow="${w.id}">${icon('play')} 运行流程</button><button class="btn small" data-export-workflow="${w.id}">${icon('download')} 导出分享</button></div></article>`).join('')}` : d.runs.length ? `<div class="panel pad">${d.runs.slice(0, 30).map(r => runRow(r)).join('')}</div>` : empty('还没有运行记录', '每次流程的步骤、状态与错误都会保存在这里。')}`;
}
function runRow(run, body = '', actions = '') {
  const steps = run.steps.map(s => `<span class="run-step ${s.status}">${s.status === 'done' ? '✓' : s.status === 'failed' ? '×' : '·'} ${state.data.plugins.find(p => p.id === s.id)?.name}</span>`).join('');
  return `<div class="run-row"><div class="spread"><h3>${escape(run.request)}</h3><small>${fmtDate(run.createdAt)}</small></div>${steps}${run.error ? `<div class="notice">${escape(run.error)}</div>` : ''}${body}${run.noteId || actions ? `<div class="row">${run.noteId ? `<button class="btn small" data-note="${run.noteId}">打开笔记</button>` : ''}${actions}</div>` : ''}</div>`;
}
function cardEditor(card) {
  openModal(card ? '编辑卡片' : '创建复习卡片', `<form id="card-form" data-id="${card?.id || ''}"><label class="field-label" for="card-question">问题</label><textarea class="field" id="card-question" required placeholder="什么是导数？">${escape(card?.question || '')}</textarea><label class="field-label" for="card-answer">答案</label><textarea class="field" id="card-answer" required>${escape(card?.answer || '')}</textarea>${card ? '<p class="hint">编辑不会改变已有的复习进度。</p>' : ''}<div class="modal-footer"><button class="btn primary" type="submit">${card ? '保存修改' : '加入复习'}</button></div></form>`);
}
// 工作台的信息流：按所选工具展示它自己的记录，并配上增删改查动作。
function workbenchFeed() {
  const d = state.data, toolId = state.wbTool;
  if (toolId === 'save') {
    const notes = inCourse(d.notes);
    return notes.length ? notes.map(n => `<div class="run-row"><div class="spread"><h3>${escape(n.title)}</h3><small>${fmtDate(n.createdAt)}</small></div>${n.source ? `<p class="hint">来源：${escape(n.source.name)} 第 ${n.source.page} 页</p>` : ''}<div class="row"><button class="btn small" data-note="${n.id}">打开</button><button class="btn small" data-action="wb-edit-note" data-id="${n.id}">编辑</button><button class="btn small" data-action="wb-delete-note" data-id="${n.id}">删除</button></div></div>`).join('') : '<p class="hint">当前课程还没有笔记。「保存笔记」工具会在这里新增一条。</p>';
  }
  if (toolId === 'cards') {
    const cards = inCourse(d.cards);
    return cards.length ? cards.map(c => `<div class="run-row"><h3>${escape(c.question)}</h3><p class="hint">${escape(c.answer)}</p><small>复习 ${c.reviews} 次 · 到期 ${fmtDate(c.dueAt)}</small><div class="row"><button class="btn small" data-action="wb-edit-card" data-id="${c.id}">编辑</button><button class="btn small" data-action="wb-delete-card" data-id="${c.id}">删除</button></div></div>`).join('') : '<p class="hint">当前课程还没有卡片。</p>';
  }
  const runs = d.runs.filter(r => r.courseId === state.courseId && r.steps?.some(s => s.id === toolId));
  if (!runs.length) return `<p class="hint">还没有「${escape(toolLabels(toolId))}」的运行记录。</p>`;
  return runs.slice(0, 30).map(r => {
    const output = (r.output || '').slice(0, 800);
    const body = output ? `<div class="wb-output">${toolId === 'translate' ? decorateWords(output) : escape(output)}</div>` : '';
    return runRow(r, body, `<button class="btn small" data-action="wb-rerun" data-id="${r.id}">再运行一次</button><button class="btn small" data-action="wb-delete-run" data-id="${r.id}">删除</button>`);
  }).join('');
}
function workbenchView() {
  const d = state.data;
  const tool = d.plugins.find(p => p.id === state.wbTool) || d.plugins[0];
  state.wbTool = tool.id;
  const blocked = d.preferences.mode === 'classroom' || (d.preferences.mode === 'exam' && tool.id !== 'dictionary');
  const modeNote = d.preferences.mode === 'exam' ? '<div class="offline-banner">考试模式：只保留内置词典等本地操作，其余工具已禁用。</div>' : d.preferences.mode === 'classroom' ? '<div class="offline-banner">课堂模式只记录。请课后切回学习模式再运行工具。</div>' : '';
  const newestCard = inCourse(d.cards).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  const lastDictionary = d.runs.map(r => ({ steps: r.steps || [], run: r })).find(x => x.steps.some(s => s.id === 'dictionary'))?.run;
  const dictionary = lastDictionary ? { word: lastDictionary.request, meaning: (lastDictionary.output || '').split('\n').slice(1).join('\n').trim() || '内置小词库未收录该词。' } : null;
  const runPanel = tool.id === 'calculator'
    ? `<div class="panel pad wb-run"><p class="hint">算式直接在上方键盘或显示屏里输入。运行后结果会作为一条运行记录留在下方。</p><div class="row"><button class="btn primary" data-action="wb-run" ${blocked ? 'disabled' : ''}>${icon('play')} 计算并记录</button></div></div>`
    : `<div class="panel pad wb-run"><label class="field-label" for="wb-input">${escape(toolLabels(tool.id))}</label><textarea class="field" id="wb-input" placeholder="输入或粘贴材料…">${escape(state.wbInput)}</textarea><label class="field-label" for="wb-request">任务描述（可选）</label><input class="field" id="wb-request" maxlength="2000" value="${escape(state.wbRequest)}" placeholder="例如：翻译并解释这段公式"><div class="row"><button class="btn primary" data-action="wb-run" ${blocked ? 'disabled' : ''}>${icon('play')} ${tool.id === 'save' ? '保存到笔记' : `运行「${escape(tool.name)}」`}</button>${tool.id === 'cards' ? button('手动新建卡片', 'wb-new-card') : ''}</div><p class="hint">${escape(tool.description)}</p></div>`;
  return `<div class="wb-page">${heading('工作台', '先选一个工具，再处理材料；结果留在下方信息流。')}${modeNote}<div class="panel pad wb-bar"><div><label class="field-label" for="wb-tool">选择工具</label><select class="select" id="wb-tool" aria-label="选择工具">${d.plugins.map(p => `<option value="${p.id}" ${p.id === tool.id ? 'selected' : ''}>${escape(p.name)}</option>`).join('')}</select></div><span class="pill">${tool.online && !d.model.configured ? '待配置模型' : tool.online ? '在线工具' : '本地运行'}</span><p class="hint">当前课程：${escape(currentCourse().name)}。这里只运行你选定的这一个工具，不做关键词自动规划。</p></div>${toolWorkspace(tool.id, { courseName: currentCourse().name, card: newestCard, dictionary, noteTitle: state.wbNoteTitle })}${runPanel}<h2>${tool.id === 'save' ? '本课程笔记' : tool.id === 'cards' ? '本课程卡片' : '运行记录'}</h2><div class="wb-feed" id="wb-feed">${workbenchFeed()}</div></div>`;
}
async function runTool() {
  const tool = state.data.plugins.find(p => p.id === state.wbTool);
  const request = ($('#wb-request')?.value || '').trim() || tool.name;
  if (tool.id === 'calculator') {
    const shown = ($('#wb-calc-display')?.value || toolState.calc || '').trim();
    if (!shown) return toast('请先用下方按键或输入算式。');
    toolState.calc = shown;
    // 键盘用的是排版符号（× ÷ −），而服务端解析器只接受 + - * / ^，这里先归一化。
    const expression = shown.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
    return await run(['calculator'], expression, request);
  }
  const input = ($('#wb-input')?.value || '').trim();
  if (tool.id === 'save') {
    if (!input) return toast('请先输入笔记正文。');
    const title = ($('#wb-title')?.value || '').trim() || '工作台笔记';
    await api('/notes', { courseId: state.courseId, title, content: input, source: currentSource() });
    state.wbInput = ''; state.wbNoteTitle = '';
    await refresh(); return toast('笔记已保存。');
  }
  if (!input) return toast('请先输入材料。');
  state.wbInput = '';
  return await run([tool.id], input, request);
}
// 点结果里的英文单词时查真实的内置词典，不返回本地示意词表。
async function lookupWord(word) {
  try {
    const result = await request('/run', { courseId: state.courseId, steps: ['dictionary'], input: word, request: word });
    const meaning = (result.output || '').split('\n').slice(1).join('\n').trim() || '内置小词库未收录该词。';
    toolState.wordDetail = `${word} · ${meaning}`;
    const pane = $('#wb-word'); if (pane) pane.textContent = toolState.wordDetail;
    $$('[data-wb-word]').forEach(item => item.classList.toggle('selected', item.dataset.wbWord === word));
    toast(toolState.wordDetail);
    await refresh(false);
  } catch (error) { toast(error.message || '查词失败。'); }
}
function settingsView() {
  const d = state.data;
  return heading('让助手，适合你的节奏。', '你决定什么时候记录、哪些内容可以被处理。') + `<div class="panel pad settings-panel"><h2>学习与权限</h2><div class="setting-row"><div><h3>模型连接</h3><p>${d.model.configured ? `已配置：${escape(d.model.name)}` : '尚未配置。请在电脑的 D:\\khoj\\software\\.env 填入 AI_BASE_URL、AI_API_KEY、AI_MODEL 后重启服务。'}</p></div><span class="pill ${d.model.configured ? '' : 'warn'}">${d.model.configured ? '可用' : '待配置'}</span></div><div class="setting-row"><div><h3>允许模型网络调用</h3><p>启用后，你提交的文字或圈选图片会发送到配置的模型服务。<br>不会自动上传整个资料库。</p></div><button role="switch" aria-checked="${d.preferences.network}" aria-label="允许模型网络调用" class="toggle ${d.preferences.network ? 'on' : ''}" data-setting="network"></button></div><div class="setting-row"><div><h3>自动保存学习结果</h3><p>将问答结果与课件页码归入当前课程笔记。</p></div><button role="switch" aria-checked="${d.preferences.autoSave}" aria-label="自动保存学习结果" class="toggle ${d.preferences.autoSave ? 'on' : ''}" data-setting="autoSave"></button></div><div class="setting-row"><div><h3>离线笔记快照</h3><p>在此浏览器保存课程、笔记和卡片。断开后端时可查看。<br>关闭后清除本设备快照，不影响后端数据库。</p></div><button role="switch" aria-checked="${localStorage.getItem('study-offline-enabled') === 'true'}" aria-label="离线笔记快照" class="toggle ${localStorage.getItem('study-offline-enabled') === 'true' ? 'on' : ''}" data-action="toggle-offline"></button></div><div class="setting-row"><div><h3>随手记入口</h3><p>网页内可切换悬浮球、胶囊和底部条；Android 跨应用悬浮球请在下方“原生工具”开启。</p></div><select id="float-select" class="select"><option value="ball" ${state.floatShape === 'ball' ? 'selected' : ''}>悬浮球</option><option value="capsule" ${state.floatShape === 'capsule' ? 'selected' : ''}>侧边胶囊</option><option value="bar" ${state.floatShape === 'bar' ? 'selected' : ''}>底部条</option></select></div><div class="notice">浏览器版不具备系统级跨应用悬浮能力。Android 悬浮球可显示在其他应用上方，但部分安全界面会由系统隐藏；截图须每次授权。麦克风与屏幕捕获通常需要 HTTPS 或 localhost。</div><div class="notice green">考试模式仅限制本应用功能，不能认证为考试获准工具。首版保留已存笔记与内置词典；是否允许使用由考试规则决定。</div><p class="hint">模型密钥仅从服务端环境变量读取，不在此页面显示。资料保存在项目 data 目录。局域网访问须配置口令；多用户账户和云端同步尚未实现。</p></div>`;
}

function navigate(view) { state.view = view; state.query = ''; if (view !== 'reader') renderGeneration++; render(); window.scrollTo({ top: 0 }); }
function setCourse(id) { state.courseId = id; localStorage.setItem('study-course', id); state.documentId = null; state.selection = ''; state.image = ''; state.chat = []; state.sessionId = null; state.query = ''; state.flipped = false; }
function openDoc(id, page = 1) { const doc = state.data.documents.find(d => d.id === id); if (!doc) return toast('课件在当前离线快照中不可用。'); if (doc.courseId !== state.courseId) setCourse(doc.courseId); state.documentId = id; state.page = Math.max(1, Math.min(page, doc.pages.length)); state.selection = ''; state.image = ''; state.chat = []; navigate('reader'); }
const currentSource = () => currentDoc() && state.view === 'reader' ? { documentId: currentDoc().id, page: state.page } : null;
function pickFile(accept, callback, capture) { const el = document.createElement('input'); el.type = 'file'; el.accept = accept; if (capture) el.capture = 'environment'; el.onchange = () => { if (el.files[0]) Promise.resolve(callback(el.files[0])).catch(e => toast(e.message)); }; el.click(); }
const toBase64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
async function importFile(file) {
  if (uploadBusy) return toast('已有文件正在导入，请稍候。');
  if (file.size > 20 * 1024 * 1024) throw new Error('文件不能超过 20 MB。');
  uploadBusy = true; toast('正在解析 ' + file.name + '…');
  try {
    const entry = await queueUpload(file, { kind: 'document', courseId: state.courseId });
    if (!state.offline) await flush();
    const uploaded = (await entries()).find(e => e.id === entry.id);
    await refresh(false);
    if (uploaded.result) { openDoc(uploaded.result.id); toast('课件已导入，开始拾起知识吧。'); }
    else { render(); toast('文件已保存在本机，连接电脑后自动续传。'); }
  } finally { uploadBusy = false; }
}
function download(name, text, mime = 'text/markdown;charset=utf-8') { const url = URL.createObjectURL(new Blob([text], { type: mime })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function noteModal(id) {
  const note = state.data.notes.find(n => n.id === id); if (!note) return;
  openModal(note.title, `<span class="pill">${fmtDate(note.createdAt)} · ${escape(state.data.courses.find(c => c.id === note.courseId)?.name)}</span><div class="note-content">${noteMarkup(note.content)}</div>${note.source ? `<button class="btn small" data-source="${note.source.documentId}" data-page="${note.source.page}">${icon('link')} 回到来源 · 第 ${note.source.page} 页</button>` : ''}<div class="modal-footer"><button class="btn" data-note-export="${id}">${icon('download')} 导出 Markdown</button><button class="btn" data-note-ai="${id}">${icon('sparkles')} 继续理解</button><button class="btn primary" data-note-edit="${id}">编辑笔记</button></div>`, true);
}
function noteEditor(note, content = '') {
  openModal(note ? '编辑笔记' : '新建笔记', `<form id="note-form" data-id="${note?.id || ''}"><label class="field-label" for="note-title">标题</label><input class="field" id="note-title" required maxlength="150" value="${escape(note?.title || '')}" placeholder="给这个知识点起个名字"><label class="field-label" for="note-content">内容</label><textarea class="field" id="note-content" required style="min-height:260px">${escape(note?.content || content)}</textarea><p class="hint">保存到：${escape(currentCourse().name)}${currentSource() ? ' · 保留课件页码' : ''}</p><div class="modal-footer">${button('取消', 'close-modal')}<button class="btn primary" type="submit">保存笔记</button></div></form>`, true);
}
function workflowModal(workflow) {
  const steps = workflow.steps;
  openModal(workflow.name, `<form id="run-form"><p class="hint">${escape(workflow.description || '')}</p><div class="workflow-steps">${steps.map(s => `<span>${state.data.plugins.find(p => p.id === s).name}</span>`).join(' → ')}</div><label class="field-label" for="run-input">学习材料</label><textarea class="field" id="run-input" placeholder="粘贴课件文字，或先在阅读器圈选">${escape(state.selection || (state.view === 'reader' ? currentDoc()?.pages[state.page - 1].text : '') || '')}</textarea>${state.image ? '<p class="hint">将使用当前已圈选的图片。</p>' : ''}<label class="field-label" for="run-request">你希望怎样处理？</label><input class="field" id="run-request" value="${escape(workflow.name)}"><p class="hint">归档课程：${escape(currentCourse().name)}。在线工具需配置模型并启用网络权限。</p><div class="modal-footer"><button type="submit" class="btn primary" ${state.busy ? 'disabled' : ''}>${icon('play')} 运行流程</button></div></form>`);
  $('#run-form').dataset.steps = JSON.stringify(steps);
}
async function run(steps, input, request) {
  if (state.busy) return;
  const context = { courseId: state.courseId, source: currentSource(), image: state.image, history: [...state.chat] };
  state.busy = true; state.chat.push({ role: 'user', content: request }); closeModal();
  renderAssistant(); toast('已开始运行工具流程。');
  try {
    const queued = await queueJob({ ...context, steps, input, request });
    if (!state.offline) await flush();
    let local = (await entries()).find(e => e.id === queued.id);
    // Briefly observe fast local tools; long model jobs continue on the PC independently.
    for (let i = 0; i < 8 && local.status === 'submitted'; i++) { await new Promise(r => setTimeout(r, 120)); await flush(); local = (await entries()).find(e => e.id === queued.id); }
    const result = local.result?.run;
    if (!result || !['done', 'failed', 'cancelled'].includes(local.result?.status)) {
      state.chat.push({ role: 'assistant', content: state.offline ? '任务已保存到本机，连接电脑后自动提交。' : '电脑正在后台处理。可以离开页面，在「连接与进度」查看结果。' });
      pendingResults.add(queued.id);
      await refresh(false); render(); toast('任务已加入队列。'); return;
    }
    state.chat.push({ role: 'assistant', content: result.status === 'failed' ? (result.output ? result.output + '\n\n' : '') + '未完成：' + result.error : result.output });
    await refresh(false);
    if (state.view === 'reader') renderAssistant();
    else { render(); openModal(result.status === 'failed' ? '流程未完成' : '学习结果', `<div class="note-content">${escape(result.output || result.error)}</div>${result.status === 'failed' && result.output ? `<div class="notice">${escape(result.error)}</div>` : ''}${result.noteId ? `<button class="btn primary" data-note="${result.noteId}">查看已保存笔记</button>` : ''}`, true); }
    toast(result.status === 'done' ? (result.noteId ? '完成，结果已归入课程笔记。' : '工具已完成。') : result.error);
  } catch (e) { state.chat.push({ role: 'assistant', content: e.message }); renderAssistant(); throw e; }
  finally { state.busy = false; renderAssistant(); }
}
function ask(steps) {
  const request = $('#chat-request')?.value.trim() || (steps ? state.data.plugins.find(p => p.id === steps[0]).name : '解释这段学习材料');
  const input = state.selection || (state.view === 'reader' ? currentDoc()?.pages[state.page - 1]?.text : '') || request;
  return run(steps, input, request);
}
function captureToolPicker(id) {
  return `<div class="capture-tool-card" id="${id}"><span class="capture-tool-label">使用工具</span><button type="button" class="capture-tool-trigger" data-action="capture-picker" aria-expanded="false">${escape(overlayTools[state.captureTool])}<span aria-hidden="true">⌄</span></button><div class="capture-tool-options" hidden>${Object.entries(overlayTools).filter(([key]) => key !== 'capture').map(([key, name]) => `<button type="button" data-action="capture-select" data-tool-id="${key}" aria-pressed="${key === state.captureTool}">${escape(name)}${key === state.captureTool ? '  ✓' : ''}</button>`).join('')}</div></div>`;
}
async function captureModal(tool = 'explain') {
  if (window.StudyNative && state.data.preferences.mode === 'study') {
    const result = await nativeCall('toolPanel', { tool });
    if (result.body.opened) return;
  }
  if (state.data.preferences.mode === 'classroom' && activeSession()) return eventModal('文字');
  state.captureTool = tool !== 'capture' && overlayTools[tool] ? tool : 'explain';
  openModal('随手拾起一个知识点', `<div class="capture-menu"><p class="capture-intro">选好工具，输入文字或截取当前屏幕。</p>${captureToolPicker('capture-tool')}<label class="field-label" for="capture-text">输入或粘贴文字</label><textarea class="field capture-text" id="capture-text" placeholder="直接输入问题或粘贴内容…">${escape(state.selection)}</textarea><div class="capture-input-actions"><button class="btn primary" data-action="capture-ask">${icon('sparkles')} 处理文字</button><button class="btn" data-action="capture-file">${icon('camera')} 导入截图</button></div><button class="capture-main-action" data-action="screen-capture">${icon('scan')}<span><strong>截取当前屏幕</strong><small>截图后圈选需要处理的内容</small></span><span aria-hidden="true">→</span></button><p class="capture-context">当前课程：${escape(currentCourse().name)} · Alt+Q 快速打开 · ${window.StudyNative ? 'Android 每次截图需系统授权' : '浏览器会显示系统选屏窗口'}</p></div>`);
}
async function cropFile(file, tool = state.captureTool || 'explain') {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
  if (file.size > 20 * 1024 * 1024) throw new Error('截图请控制在 20 MB 内。');
  const image = `data:${file.type};base64,${await toBase64(file)}`;
  const source = new Image(); source.src = image; await source.decode();
  state.selection = ''; state.image = encodeCrop(source, 0, 0, source.naturalWidth, source.naturalHeight); state.captureTool = tool !== 'capture' && overlayTools[tool] ? tool : 'explain';
  openModal('圈选需要理解的区域', `<div class="capture-preview"><div class="canvas-wrap" id="capture-wrap"><img src="${image}" alt="待圈选截图"></div></div><p class="hint" id="crop-status">拖动框选局部；不框选则使用整张图片。</p>${captureToolPicker('crop-tool')}<div class="modal-footer">${button('保存到笔记', 'save-selection')}${button('处理选区', 'crop-run', 'primary')}</div>`, true);
  attachCrop($('#capture-wrap'), image => { state.image = image; $('#crop-status').textContent = '选区已更新，将只处理圈选区域。'; toast('已选取局部区域。'); });
}
async function handleOverlayAction() {
  if (!state.data || overlayHandling || !window.studyPendingOverlayAction) return;
  overlayHandling = true;
  const action = window.studyPendingOverlayAction;
  try {
    if (state.data.preferences.mode === 'exam') { toast('考试模式已禁用截图与工具调度。'); return; }
    if (!action.captureId) { captureModal(action.tool); return; }
    const { body } = await nativeCall('inbox');
    const item = (body.items || []).find(i => i.id === action.captureId && i.kind === 'capture');
    if (!item) throw new Error('截图已不可用，请重新截图。');
    const parts = [];
    for (let offset = 0; offset < item.size; offset += 256 * 1024) {
      const response = await nativeCall('readInbox', { id: item.id, offset });
      parts.push(Uint8Array.from(atob(response.body.data), c => c.charCodeAt(0)));
    }
    await cropFile(new File(parts, item.name, { type: item.mime }), action.tool);
    await nativeCall('ackInbox', { id: item.id });
  } catch (error) { toast(error.message || '截图导入失败'); }
  finally { window.studyPendingOverlayAction = null; overlayHandling = false; }
}
async function screenCapture() {
  state.captureTool = state.captureTool || 'explain';
  if (window.StudyNative) { await nativeCall('capture', { tool: state.captureTool }); closeModal(); return; }
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('此浏览器不支持屏幕捕获，请先系统截图再导入。');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement('video'); video.srcObject = stream; await video.play();
    await new Promise(resolve => video.requestVideoFrameCallback ? video.requestVideoFrameCallback(resolve) : setTimeout(resolve, 250));
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob.size > 20 * 1024 * 1024) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .96));
    await cropFile(new File([blob], '屏幕截图.' + (blob.type === 'image/png' ? 'png' : 'jpg'), { type: blob.type }));
  } finally { stream.getTracks().forEach(t => t.stop()); }
}
function eventModal(type) {
  const session = activeSession(); if (!session) throw new Error('请先开始一堂课。');
  openModal(type === '页码' ? '记录课件页码' : '记录' + type, `<form id="event-form" data-type="${type}">${type === '页码' ? `<label class="field-label">课件</label><select class="field select" id="event-doc">${state.data.documents.filter(d => d.courseId === session.courseId).map(d => `<option value="${d.id}">${escape(d.name)}</option>`).join('')}</select><label class="field-label">页码</label><input id="event-page" class="field" type="number" value="1" min="1" required>` : ''}<label class="field-label" for="event-text">${type === '疑问' ? '哪里还没有理解？' : '记录内容'}</label><textarea class="field" id="event-text" placeholder="简短记下，课后再展开…" ${type === '页码' ? '' : 'required'}></textarea><div class="modal-footer"><button type="submit" class="btn primary">记入时间轴</button></div></form>`);
}
async function addEvent(type, text, extra = {}, sessionId = activeSession()?.id) {
  if (!sessionId) throw new Error('请先开始课堂。');
  await api(`/sessions/${sessionId}/events`, { type, text, ...extra }); await refresh(); toast('已记入课堂时间轴。');
}
async function photoEvent(file) { const sessionId = activeSession()?.id, capturedAt = new Date().toISOString(); if (!sessionId) throw new Error('请先开始课堂。'); const saved = await api('/media', { name: file.name, mime: file.type, data: await toBase64(file) }); await addEvent('板书', '板书照片', { fileId: saved.id, capturedAt }, sessionId); }
async function toggleRecord() {
  if (window.StudyNative) { const session = activeSession(); if (!session) throw new Error('请先开始课堂。'); const status = await nativeCall('recordingStatus'); await nativeCall(status.body.recording ? 'stopRecording' : 'startRecording', { sessionId: session.id, courseId: session.courseId }); toast(status.body.recording ? '原生录音已停止，附件将进入同步队列。' : '原生录音已开始，可从通知栏停止。'); return; }
  if (recording) return stopRecording();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('录音需要受支持的浏览器与 HTTPS / localhost。');
  const sessionId = activeSession()?.id; if (!sessionId) throw new Error('请先开始课堂。');
  recordStream = await navigator.mediaDevices.getUserMedia({ audio: true }); recordChunks = [];
  recording = new MediaRecorder(recordStream); const recorder = recording, capturedAt = new Date().toISOString();
  recorder.ondataavailable = e => { if (e.data.size) recordChunks.push(e.data); };
  recorder.onerror = () => toast('录音出现错误，请停止后重试。');
  recorder.onstop = async () => {
    clearTimeout(recordTimer); recordStream?.getTracks().forEach(t => t.stop());
    const blob = new Blob(recordChunks, { type: recorder.mimeType }), durationMs = Date.now() - Date.parse(capturedAt); recording = null;
    try { const mime = recorder.mimeType.split(';')[0]; const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm'; const file = await api('/media', { name: `课堂录音-${Date.now()}.${ext}`, mime, data: await toBase64(blob) }); await addEvent('录音', '课堂录音片段', { fileId: file.id, capturedAt, durationMs: Math.min(durationMs, 360000) }, sessionId); stopRecording.resolve?.(); }
    catch (e) { download('未上传的课堂录音.webm', blob, recorder.mimeType); toast('录音上传失败，已下载到本机：' + e.message); stopRecording.reject?.(e); }
    finally { render(); }
  };
  recorder.start(1000); recordTimer = setTimeout(() => stopRecording().catch(e => toast(e.message)), 5 * 60000); render(); toast('录音已开始，5 分钟后自动保存本段。');
}
function stopRecording() { return new Promise((resolve, reject) => { if (!recording || recording.state === 'inactive') return resolve(); stopRecording.resolve = resolve; stopRecording.reject = reject; recording.stop(); }); }

function syncChanged(error) {
  if (error) state.syncError = error.message;
  clearTimeout(syncChanged.timer);
  syncChanged.timer = setTimeout(async () => {
    const items = await entries();
    if ($('#sync-list')) $('#sync-list').innerHTML = syncList(items);
    if (state.view === 'workbench' && $('#wb-feed') && !document.hidden) $('#wb-feed').innerHTML = workbenchFeed();
    for (const id of [...pendingResults]) {
      const item = items.find(entry => entry.id === id);
      if (!item || !['done', 'failed', 'cancelled', 'interrupted', 'blocked'].includes(item.status)) continue;
      pendingResults.delete(id);
      const result = item.result?.run;
      const output = result?.output || result?.error || item.error || '任务未完成。';
      state.chat.push({ role: 'assistant', content: output });
      if (state.view === 'reader') renderAssistant();
      else if (!document.hidden) openModal(item.status === 'done' ? '学习结果' : '任务未完成', `<div class="note-content">${escape(output)}</div>${result?.noteId ? `<button class="btn primary" data-note="${result.noteId}">查看已保存笔记</button>` : ''}`, true);
      toast(item.status === 'done' ? '电脑处理完成，结果已到达手机。' : '电脑任务未完成，请查看连接与进度。');
    }
  }, 80);
}
const statusNames = { pending: '待连接', sending: '传输中', blocked: '需处理', submitted: '电脑处理中', running: '电脑处理中', queued: '等待处理', done: '已完成', failed: '失败', interrupted: '服务中断', cancelled: '已取消' };
function syncList(items) {
  return items.length ? items.slice().reverse().slice(0, 50).map(e => `<div class="run-row"><div class="spread"><h3>${escape(e.name || '同步操作')}</h3><span class="pill">${statusNames[e.status] || escape(e.status)}${e.progress ? ' · ' + e.progress + '%' : ''}</span></div>${e.error || e.result?.error ? `<p class="notice">${escape(e.error || e.result.error)}</p>` : ''}${e.result?.run ? `<p class="hint">${e.result.run.steps.map(s => `${state.data.plugins.find(p => p.id === s.id)?.name || s.id}：${s.status}`).join(' → ')}</p>` : ''}<div class="row">${e.result?.run?.noteId ? `<button class="btn small" data-note="${e.result.run.noteId}">查看结果笔记</button>` : ''}${e.type === 'job' && e.result?.run?.output ? `<button class="btn small" data-job-result="${e.id}">查看结果</button>` : ''}${['blocked', 'failed', 'interrupted', 'cancelled', 'pending'].includes(e.status) ? `<button class="btn small" data-sync-retry="${e.id}">重试 / 继续</button>` : ''}${['note.update', 'note.create'].includes(e.operation?.kind) && e.status === 'blocked' ? `<button class="btn small" data-sync-copy="${e.id}">另存为新笔记</button>` : ''}${!['done', 'cancelled'].includes(e.status) ? `<button class="btn small" data-sync-cancel="${e.id}">取消</button>` : ''}</div></div>`).join('') : '<p class="hint">当前没有待同步内容。</p>';
}
function serviceMarkup(service) {
  const busy = service.task?.status === 'running';
  const error = service.task?.status === 'failed' ? String(service.task.error || '') : '';
  const consentUrl = error.match(/https:\/\/login\.tailscale\.com\/f\/serve\?node=[A-Za-z0-9_-]+/)?.[0];
  const tailnetStatus = busy ? '配置中，请在 Windows 授权窗口确认' : error ? `配置失败：${escape(error)}` : service.remoteEnabled ? '已开启，仅同一 Tailscale 网络可访问' : '已关闭';
  const consent = consentUrl ? `<p class="hint">此 tailnet 尚未授权 Tailscale Serve。请由账户所有者在 <a href="${escape(consentUrl)}" target="_blank" rel="noopener noreferrer">Tailscale 官方授权页</a>确认，然后回到这里重新点击“开启异网连接”。</p>` : '';
  const url = service.tailnetUrl ? `<p class="hint">手机填写：<code>${escape(service.tailnetUrl)}</code></p>` : '';
  return `<div class="notice green">拾知后台正在运行 · PC 控制页仅本机可访问</div><div class="setting-row"><div><h3>手机接入</h3><p>${service.mobileEnabled ? '已开启，配对手机可连接与同步。' : '已关闭，配对手机暂不能同步。'}</p></div><button class="btn" data-action="service-mobile" data-enabled="${!service.mobileEnabled}">${service.mobileEnabled ? '关闭手机接入' : '开启手机接入'}</button></div><div class="setting-row"><div><h3>Tailscale 异网 HTTPS</h3><p>${tailnetStatus}</p>${consent}${url}</div><button class="btn" data-action="service-tailnet" data-enabled="${!service.remoteEnabled}" ${busy ? 'disabled' : ''}>${service.remoteEnabled ? '关闭异网连接' : '开启异网连接'}</button></div><p class="hint">先在电脑和手机登录同一 Tailscale 网络。开启/关闭转发时可能弹出 Windows 授权；取消后此处会显示错误。关闭手机接入会阻断经 Tailscale 的手机访问。</p>${service.canStop ? '<div class="modal-footer"><button class="btn" data-action="service-stop">停止拾知后台</button></div>' : ''}`;
}
async function serviceCenter() {
  const service = await request('/control');
  openModal('电脑服务控制台', `<div id="control-state">${serviceMarkup(service)}</div>`, true);
}
let servicePollBusy = false;
setInterval(async () => {
  if (!$('#control-state') || servicePollBusy) return;
  servicePollBusy = true;
  try { const service = await request('/control'); if ($('#control-state')) $('#control-state').innerHTML = serviceMarkup(service); }
  catch { /* A stopped service leaves the last status visible until the page reloads. */ }
  finally { servicePollBusy = false; }
}, 2500);
async function connectionCenter() {
  openModal('连接与同步进度', `<div class="notice green">${escape(state.data.connection?.name || '电脑工作站')} · ${state.offline ? '离线，内容保留在本机' : '已连接'}<br>电脑身份：${escape(state.data.connection?.serverId || '')}</div><div class="row">${button('立即同步', 'flush-sync')}${button('连接 / 配对电脑', 'pair-dialog')}${state.data.connection?.admin ? button('生成手机配对码', 'create-pair-code') : ''}${window.StudyNative ? button('收取分享 / 录音附件', 'native-inbox') : ''}</div><div id="pair-detail"></div><p class="hint">手机需能访问电脑地址。跨网络请使用你配置的可信 HTTPS 或私有网络；不会自动开放公网端口。</p><h3>本机队列</h3><div id="sync-list">${syncList(await entries())}</div>${state.data.connection?.admin ? '<div id="device-list"></div><div id="pc-jobs"></div>' : ''}`, true);
  if (state.data.connection?.admin && !state.offline) {
    const devices = await request('/devices');
    if ($('#device-list')) $('#device-list').innerHTML = '<h3 class="section-spacer">已配对设备</h3>' + devices.map(d => `<div class="setting-row"><span>${escape(d.name)} · ${d.revokedAt ? '已撤销' : '已授权'}</span>${d.revokedAt ? '' : `<button class="btn small" data-revoke-device="${d.id}">撤销</button>`}</div>`).join('');
    const jobs = await request('/jobs');
    if ($('#pc-jobs')) $('#pc-jobs').innerHTML = '<h3 class="section-spacer">电脑任务</h3>' + jobs.slice(0, 15).map(j => `<div class="run-row"><h3>${escape(j.name)} · ${statusNames[j.status]}</h3><p class="hint">${j.progress}% ${escape(j.error || '')}</p>${j.run?.noteId ? `<button class="btn small" data-note="${j.run.noteId}">打开结果笔记</button>` : ''}</div>`).join('');
  }
}
function pairDialog() {
  openModal('连接电脑工作站', `<form id="pair-form">${window.StudyNative ? '<label class="field-label" for="pc-address">电脑地址</label><input class="field" id="pc-address" placeholder="https://你的电脑名.xxx.ts.net" required inputmode="url"><p class="hint">异网连接请填电脑网页“服务控制台”显示的 Tailscale HTTPS 地址；同一可信 Wi-Fi 也可填局域网 HTTP 地址。</p>' : '<p class="hint">当前地址即为要连接的电脑。如需连接另一台电脑，请先在浏览器打开其地址。</p>'}<label class="field-label" for="pair-name">设备名称</label><input class="field" id="pair-name" value="我的手机" required maxlength="80"><label class="field-label" for="pair-code">电脑端显示的配对码</label><input class="field" id="pair-code" required maxlength="10" autocomplete="one-time-code" placeholder="10 位配对码"><div class="modal-footer"><button class="btn primary" type="submit">配对并连接</button></div></form>`);
}
function adminLoginDialog() {
  openModal('电脑管理员登录', `<form id="login-form"><p class="hint">请输入本机 data/mobile-access-key 文件中的访问口令。此口令不要发给手机；手机只使用一次性配对码。</p><label class="field-label" for="login-token">管理员访问口令</label><input class="field" id="login-token" type="password" required autocomplete="current-password"><div class="modal-footer"><button class="btn primary" type="submit">登录电脑工作站</button></div></form>`, true);
}
async function nativeInbox() {
  if (!window.StudyNative) return;
  const { body } = await nativeCall('inbox');
  for (const item of body.items || []) {
    if (item.kind === 'capture' || item.kind === 'overlay-job') continue; // Native overlay owns these durable screenshot tasks.
    const existing = (await entries()).find(e => e.id === item.id);
    let uploaded = existing;
    if (!existing) {
      const parts = [];
      for (let offset = 0; offset < item.size; offset += 256 * 1024) { const part = await nativeCall('readInbox', { id: item.id, offset }); parts.push(Uint8Array.from(atob(part.body.data), c => c.charCodeAt(0))); }
      uploaded = await queueUpload(new Blob(parts, { type: item.mime }), { id: item.id, kind: item.sessionId ? 'media' : 'document', courseId: item.courseId || state.courseId, name: item.name, mime: item.mime });
    }
    if (item.sessionId) {
      const duplicates = (await entries()).some(e => e.operation?.kind === 'event.create' && e.dependency === item.id);
      if (!duplicates) await queueOperation('event.create', { sessionId: item.sessionId, type: '录音', text: '原生课堂录音', capturedAt: item.capturedAt, durationMs: item.durationMs }, undefined, uploaded.id);
    }
    await nativeCall('ackInbox', { id: item.id });
  }
  await flush(); await refresh(); toast('原生附件已进入本机队列，连接电脑后自动上传。');
}
document.addEventListener('click', async e => {
  const el = e.target.closest('button'); if (!el) return;
  try {
    if (el.dataset.syncRetry) { await retryEntry(el.dataset.syncRetry); return await refresh(false); }
    if (el.dataset.syncCancel) { await cancelEntry(el.dataset.syncCancel); return; }
    if (el.dataset.syncCopy) { await preserveConflict(el.dataset.syncCopy); return await refresh(false); }
    if (el.dataset.jobResult) { const item = (await entries()).find(e => e.id === el.dataset.jobResult); return openModal('后台任务结果', `<div class="note-content">${escape(item.result?.run?.output || item.result?.error)}</div>`, true); }
    if (el.dataset.revokeDevice) { await request('/devices/' + el.dataset.revokeDevice + '/revoke', {}); return connectionCenter(); }
    switch (el.dataset.action) {
      case 'service-center': return await serviceCenter();
      case 'service-mobile': await request('/control/mobile', { enabled: el.dataset.enabled === 'true' }); return serviceCenter();
      case 'service-tailnet': await request('/control/tailnet', { enabled: el.dataset.enabled === 'true' }); return serviceCenter();
      case 'service-stop':
        if (!confirm('停止拾知后台？手机同步与电脑网页会暂时不可用。')) return;
        await request('/control/stop', {}); closeModal(); return toast('后台已停止。需要时双击“启动拾知.cmd”重新启动。');
      case 'connection-center': return await connectionCenter();
      case 'pair-dialog': return pairDialog();
      case 'flush-sync': await flush(); await refresh(false); return connectionCenter();
      case 'create-pair-code': { const pair = await request('/pairing/code', {}); $('#pair-detail').innerHTML = `<div class="notice green">一次性配对码：<strong style="font-size:23px;letter-spacing:3px">${escape(pair.code)}</strong><br>5 分钟内有效。手机输入电脑地址与此码即可连接。<br>${pair.addresses.map(escape).join('<br>')}<br>${state.data.control?.available ? '手机请填写电脑网页“服务控制台”显示的 HTTPS 地址。' : '异网连接请填写可信 HTTPS 地址。'}</div>`; return; }
      case 'native-inbox': return await nativeInbox();
      case 'native-tools': return openModal('Android 原生工具', `<p class="hint">开启后悬浮球可在其他应用上方显示：轻点选工具，长按截图。系统每次确认后，在悬浮窗圈选并上传，结果回到悬浮窗，同时保存到课程笔记；不强制打开主应用。可从通知栏停止服务。</p><div class="row">${button('开启跨应用悬浮球', 'native-overlay')}${button('关闭悬浮球', 'native-overlay-off')}${button('授权屏幕截图', 'screen-capture')}${button('打开最近截图', 'native-last-capture')}${button('停止原生录音', 'native-record-stop')}${button('收取分享与录音', 'native-inbox')}</div>`);
      case 'native-overlay': await nativeCall('overlay', { enabled: true }); return;
      case 'native-overlay-off': await nativeCall('overlay', { enabled: false }); return;
      case 'native-last-capture': {
        const { body } = await nativeCall('inbox');
        const capture = (body.items || []).filter(item => item.kind === 'capture').at(-1);
        if (!capture) throw new Error('没有待圈选的截图。');
        window.studyPendingOverlayAction = { tool: 'capture', captureId: capture.id };
        return await handleOverlayAction();
      }
      case 'native-record-stop': await nativeCall('stopRecording'); toast('录音停止后，请收取原生附件。'); return;
    }
  } catch (error) { toast(error.message); }
});
document.addEventListener('submit', async e => {
  if (e.target.id !== 'pair-form') return; e.preventDefault();
  try {
    const data = { code: $('#pair-code').value.trim(), name: $('#pair-name').value.trim(), base: $('#pc-address')?.value.trim() };
    if (window.StudyNative) { const response = await nativeCall('connect', data); if (response.status !== 200) throw new Error(response.body.error); }
    else await request('/pairing/claim', data);
    closeModal(); await refresh(); toast('配对成功，手机已连接到电脑。');
  } catch (error) { toast(error.message); }
});

document.addEventListener('click', async event => {
  const el = event.target.closest('button,[data-source]'); if (!el) return;
  try {
    if (el.dataset.nav) return navigate(el.dataset.nav);
    if (el.dataset.course) { setCourse(el.dataset.course); return navigate('library'); }
    if (el.dataset.doc) return openDoc(el.dataset.doc);
    if (el.dataset.source) { closeModal(); return openDoc(el.dataset.source, Number(el.dataset.page)); }
    if (el.dataset.note) return noteModal(el.dataset.note);
    if (el.dataset.noteEdit) { const note = state.data.notes.find(n => n.id === el.dataset.noteEdit); return noteEditor(note); }
    if (el.dataset.noteExport) { const n = state.data.notes.find(n => n.id === el.dataset.noteExport); return download(n.title + '.md', '# ' + n.title + '\n\n' + n.content); }
    if (el.dataset.noteAi) { const n = state.data.notes.find(n => n.id === el.dataset.noteAi); if (state.courseId !== n.courseId) setCourse(n.courseId); state.selection = n.content; state.image = ''; return workflowModal({ name: '整理笔记重点', steps: ['summarize', 'save'] }); }
    if (el.dataset.tool) return await ask([el.dataset.tool]);
    if (el.dataset.tab) { state.tab = el.dataset.tab; return render(); }
    if (el.dataset.workflow) return workflowModal([...state.data.defaultWorkflows, ...state.data.workflows].find(w => w.id === el.dataset.workflow));
    if (el.dataset.exportWorkflow) { const w = [...state.data.defaultWorkflows, ...state.data.workflows].find(w => w.id === el.dataset.exportWorkflow); return download(w.name + '.json', JSON.stringify({ name: w.name, description: w.description, steps: w.steps, version: 1 }, null, 2), 'application/json'); }
    if (el.dataset.togglePlugin) { const list = state.data.preferences.disabledPlugins; const id = el.dataset.togglePlugin; await api('/settings', { disabledPlugins: list.includes(id) ? list.filter(x => x !== id) : [...list, id] }, 'PATCH'); return await refresh(); }
    if (el.dataset.pluginUse) return workflowModal({ name: state.data.plugins.find(p => p.id === el.dataset.pluginUse).name, steps: [el.dataset.pluginUse] });
    if (el.dataset.setting) { await api('/settings', { [el.dataset.setting]: !state.data.preferences[el.dataset.setting] }, 'PATCH'); return await refresh(); }
    if (el.dataset.transcribe) { el.disabled = true; toast('正在转写录音…'); await api('/transcribe', { eventId: el.dataset.transcribe }); await refresh(); return toast('已更新录音文字。'); }
    if (el.dataset.wbChoice) { toolAction(el.dataset.wbChoice, el.dataset.value); return render(); }
    if (el.dataset.wbKey) { calculatorKey(el.dataset.wbKey); return render(); }
    if (el.dataset.wbSwap !== undefined) { toolAction('swap'); return render(); }
    if (el.dataset.wbFlip !== undefined) { toolAction('flip'); return render(); }
    if (el.dataset.wbWord) return await lookupWord(el.dataset.wbWord);
    switch (el.dataset.action) {
      case 'wb-run': return await runTool();
      case 'wb-new-card': return cardEditor(null);
      case 'wb-edit-card': return cardEditor(state.data.cards.find(c => c.id === el.dataset.id));
      case 'wb-delete-card': { if (!confirm('删除这张卡片？删除后无法恢复。')) return; await api('/cards/' + el.dataset.id, {}, 'DELETE'); return await refresh(); }
      case 'wb-edit-note': return noteEditor(state.data.notes.find(n => n.id === el.dataset.id));
      case 'wb-delete-note': { if (!confirm('删除这篇笔记？删除后无法恢复。')) return; await api('/notes/' + el.dataset.id, {}, 'DELETE'); return await refresh(); }
      case 'wb-delete-run': { if (!confirm('删除这条运行记录？删除后无法恢复。')) return; await api('/runs/' + el.dataset.id, {}, 'DELETE'); return await refresh(); }
      case 'wb-rerun': { const run = state.data.runs.find(r => r.id === el.dataset.id); if (!run) return; state.wbTool = run.steps[0]?.id || state.wbTool; localStorage.setItem('study-wb-tool', state.wbTool); state.wbRequest = run.request || ''; state.wbInput = ''; toast('已带出上次的步骤与任务描述，请补充材料后运行。'); return render(); }
      case 'close-modal': return closeModal();
      case 'go-library': return navigate('library');
      case 'import': return pickFile('.pdf,.pptx,.png,.jpg,.jpeg,.webp,.txt,.md', importFile);
      case 'demo': return await importFile(new File(['# 导数：从平均变化到瞬时变化\n\n示例课件 · 用于体验阅读与圈选\n\nThe derivative measures the instantaneous rate of change of a function with respect to its variable.\n\n定义：f′(x) = lim(h→0) [f(x+h) − f(x)] / h\n\n示例：若 f(x) = x²，则 f′(x) = 2x。\n在 x = 3 处，切线斜率为 6。\n\n思考：平均变化率与瞬时变化率有什么区别？\n\n关键词：derivative（导数）、function（函数）、variable（变量）。\n\n试一试：选中英文，点击「选中文字提问」；或在未配置模型时点击「保存选区」创建笔记。'], '导数与变化率 · 示例.md', { type: 'text/plain' }));
      case 'new-course': return openModal('添加一门课程', '<form id="course-form"><label class="field-label" for="course-name">课程名称</label><input class="field" id="course-name" required maxlength="80" placeholder="例如：高等数学 · 上"><div class="modal-footer"><button type="submit" class="btn primary">创建课程</button></div></form>');
      case 'prev-page': state.page--; state.selection = ''; state.image = ''; state.chat = []; return render();
      case 'next-page': state.page++; state.selection = ''; state.image = ''; state.chat = []; return render();
      case 'use-selection': { const selection = window.getSelection(); if (!selection?.toString().trim() || !$('#document-text')?.contains(selection.anchorNode)) return toast('请先在课件文字中选中一段内容。'); state.selection = selection.toString().slice(0, 60000); state.image = ''; renderAssistant(); return toast('已选取文字。'); }
      case 'ask': return await ask();
      case 'save-selection': {
        if (state.image) { const media = await api('/media', { name: '圈选截图.png', mime: state.image.slice(5, state.image.indexOf(';')), data: state.image.split(',')[1] }); const text = `圈选截图：[查看原图](/api/files/${media.id})`; if (state.data.preferences.mode === 'classroom' && activeSession()) { closeModal(); return await addEvent('圈选', '课件圈选', { fileId: media.id, source: currentSource() }); } return noteEditor(null, text); }
        const content = state.selection || currentDoc()?.pages[state.page - 1]?.text || '';
        if (state.data.preferences.mode === 'classroom' && activeSession()) return await addEvent('圈选', content, { source: currentSource() });
        return noteEditor(null, content);
      }
      case 'mark-page': return await addEvent('页码', '课件阅读位置', { source: currentSource() });
      case 'new-note': return noteEditor();
      case 'export-notes': return download(currentCourse().name + '-笔记.md', inCourse(state.data.notes).map(n => `# ${n.title}\n\n${n.content}${n.source ? `\n\n来源：${n.source.name} 第 ${n.source.page} 页` : ''}`).join('\n\n---\n\n'));
      case 'new-card': return cardEditor(null);
      case 'flip-card': state.flipped = true; return render();
      case 'rate-again': case 'rate-good': case 'rate-easy': { const card = dueCards()[0]; if (!card) return; await api(`/cards/${card.id}/review`, { rating: el.dataset.action.slice(5) }); state.flipped = false; return await refresh(); }
      case 'start-session': return openModal('开始一堂课', `<form id="session-form"><p class="hint">课程：${escape(currentCourse().name)}。开始后自动切换为只记录的课堂模式。</p><input class="field" id="session-title" placeholder="例如：第 3 讲 · 导数与微分" required maxlength="120"><div class="modal-footer"><button class="btn primary" type="submit">开始记录</button></div></form>`);
      case 'end-session': { if (recording) await stopRecording(); if (window.StudyNative) { const status = await nativeCall('recordingStatus'); if (status.body.recording) await nativeCall('stopRecording'); await nativeInbox(); } const session = activeSession(); if (!session) return; await api(`/sessions/${session.id}/end`, {}); await refresh(); return toast('课堂已结束，时间轴笔记已自动生成或加入待同步队列。'); }
      case 'event-important': return eventModal('重点');
      case 'event-question': return eventModal('疑问');
      case 'event-page': return eventModal('页码');
      case 'event-photo': return pickFile('image/png,image/jpeg,image/webp', photoEvent, true);
      case 'record': return await toggleRecord();
      case 'quick-capture': return captureModal();
      case 'capture-picker': { const options = el.parentElement.querySelector('.capture-tool-options'); options.hidden = !options.hidden; el.setAttribute('aria-expanded', String(!options.hidden)); return; }
      case 'capture-select': { state.captureTool = el.dataset.toolId; const card = el.closest('.capture-tool-card'); card.querySelector('.capture-tool-trigger').innerHTML = `${escape(overlayTools[state.captureTool])}<span aria-hidden="true">⌄</span>`; card.querySelector('.capture-tool-trigger').setAttribute('aria-expanded', 'false'); card.querySelector('.capture-tool-options').hidden = true; card.querySelectorAll('.capture-tool-options button').forEach(option => { option.setAttribute('aria-pressed', String(option.dataset.toolId === state.captureTool)); option.textContent = overlayTools[option.dataset.toolId] + (option.dataset.toolId === state.captureTool ? '  ✓' : ''); }); return; }
      case 'capture-file': return pickFile('image/png,image/jpeg,image/webp', file => cropFile(file, state.captureTool));
      case 'capture-note': state.selection = $('#capture-text').value; state.image = ''; return noteEditor(null, state.selection);
      case 'capture-ask': {
        state.selection = $('#capture-text').value.trim(); state.image = '';
        const tool = state.captureTool;
        if (!state.selection) throw new Error('请先粘贴文字，或使用截图圈选。');
        if (tool === 'note') return noteEditor(null, state.selection);
        return await run(toolSteps(tool, false), state.selection, overlayTools[tool]);
      }
      case 'screen-capture': return await screenCapture();
      case 'crop-run': {
        const tool = state.captureTool;
        if (tool === 'note') { const media = await api('/media', { name: '圈选截图.jpg', mime: state.image.slice(5, state.image.indexOf(';')), data: state.image.split(',')[1] }); return noteEditor(null, `圈选截图：[查看原图](/api/files/${media.id})`); }
        return await run(toolSteps(tool, true), '', overlayTools[tool]);
      }
      case 'new-workflow': return openModal('组合一个学习流程', `<form id="workflow-form"><label class="field-label">流程名称</label><input class="field" id="workflow-name" required maxlength="80" placeholder="例如：读懂英文公式"><label class="field-label">按执行顺序选择工具</label><div id="workflow-builder"></div><select class="field select" id="workflow-step"><option value="">＋ 添加一步</option>${state.data.plugins.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select><p class="hint">按照添加顺序执行，保存笔记应放在最后。不运行导入文件中的代码。</p><div class="modal-footer"><button class="btn primary" type="submit">保存流程</button></div></form>`);
      case 'import-workflow': return pickFile('.json', async file => { if (file.size > 100000) throw new Error('流程文件过大。'); const data = JSON.parse(await file.text()); await api('/workflows', data); state.tab = 'workflows'; await refresh(); toast('流程已导入。'); });
      case 'toggle-offline': { const enable = localStorage.getItem('study-offline-enabled') !== 'true'; localStorage.setItem('study-offline-enabled', String(enable)); if (!enable) localStorage.removeItem('study-snapshot'); return state.offline ? render() : await refresh(); }
    }
  } catch (e) { toast(e.message || '操作失败，请重试。'); } finally { if (el.dataset.transcribe) el.disabled = false; }
});
document.addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target; const submit = $('[type="submit"]', form); if (submit) submit.disabled = true;
  try {
    switch (form.id) {
      case 'course-form': { const c = await api('/courses', { name: $('#course-name').value }); setCourse(c.id); closeModal(); await refresh(); break; }
      case 'note-form': { const content = $('#note-content').value, title = $('#note-title').value; await api('/notes' + (form.dataset.id ? '/' + form.dataset.id : ''), { title, content, courseId: state.courseId, source: currentSource() }, form.dataset.id ? 'PATCH' : 'POST'); closeModal(); await refresh(); toast('笔记已保存。'); break; }
      case 'card-form': await api('/cards' + (form.dataset.id ? '/' + form.dataset.id : ''), { courseId: state.courseId, question: $('#card-question').value, answer: $('#card-answer').value }, form.dataset.id ? 'PATCH' : 'POST'); closeModal(); await refresh(); toast(form.dataset.id ? '卡片已更新。' : '已加入复习。'); break;
      case 'session-form': { const session = await api('/sessions', { courseId: state.courseId, title: $('#session-title').value }); state.sessionId = session.id; closeModal(); await refresh(); break; }
      case 'event-form': { const type = form.dataset.type, text = $('#event-text').value; const source = type === '页码' ? { documentId: $('#event-doc').value, page: Number($('#event-page').value) } : null; if (type === '页码' && !source.documentId) throw new Error('请先导入课件。'); await addEvent(type, text, { source }); closeModal(); break; }
      case 'run-form': await run(JSON.parse(form.dataset.steps), $('#run-input').value, $('#run-request').value); break;
      case 'workflow-form': { const steps = $$('#workflow-builder [data-step]').map(e => e.dataset.step); await api('/workflows', { name: $('#workflow-name').value, steps, description: '自定义学习流程' }); state.tab = 'workflows'; closeModal(); await refresh(); break; }
      case 'login-form': await api('/login', { token: $('#login-token').value }); closeModal(); await refresh(); break;
    }
  } catch (error) { toast(error.message); } finally { if (submit?.isConnected) submit.disabled = false; }
});
document.addEventListener('change', async e => {
  try {
    switch (e.target.id) {
      case 'course-select': setCourse(e.target.value); return render();
      case 'mode-select': if (recording) await stopRecording(); await api('/settings', { mode: e.target.value }, 'PATCH'); return await refresh();
      case 'session-select': state.sessionId = e.target.value; return render();
      case 'float-select': state.floatShape = e.target.value; localStorage.setItem('study-float', state.floatShape); return render();
      case 'wb-tool': { state.wbTool = e.target.value; localStorage.setItem('study-wb-tool', state.wbTool); return render(); }
      case 'workflow-step': { const id = e.target.value; if (!id || $$('#workflow-builder [data-step]').some(n => n.dataset.step === id)) return; const el = document.createElement('button'); el.type = 'button'; el.className = 'run-step'; el.dataset.step = id; el.textContent = state.data.plugins.find(p => p.id === id).name + ' ×'; el.onclick = () => el.remove(); $('#workflow-builder').append(el); e.target.value = ''; }
    }
  } catch (error) { toast(error.message); render(); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'wb-input') { state.wbInput = e.target.value; return; }
  if (e.target.id === 'wb-request') { state.wbRequest = e.target.value; return; }
  if (e.target.id === 'wb-title') { state.wbNoteTitle = e.target.value; return; }
  if (e.target.id === 'wb-calc-display') { toolState.calc = e.target.value; toolState.answer = ''; return; }
  if (e.target.id === 'search') { state.query = e.target.value; const position = e.target.selectionStart; clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => { render(); $('#search')?.focus(); $('#search')?.setSelectionRange(position, position); }, 120); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.altKey && e.key.toLowerCase() === 'q') { e.preventDefault(); captureModal(); }
  if (e.key === 'Tab' && $('.modal')) { const targets = $$('button:not(:disabled),input,textarea,select,a[href]', $('.modal')); const first = targets[0], last = targets.at(-1); if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); } }
});
document.addEventListener('dragover', e => { if (e.target.closest('#drop-zone')) { e.preventDefault(); $('#drop-zone').classList.add('drop-active'); } });
document.addEventListener('dragleave', e => { e.target.closest('#drop-zone')?.classList.remove('drop-active'); });
document.addEventListener('drop', e => { if (e.target.closest('#drop-zone')) { e.preventDefault(); $('#drop-zone').classList.remove('drop-active'); const file = e.dataTransfer.files[0]; if (file) importFile(file).catch(e => toast(e.message)); } });
window.addEventListener('beforeunload', e => { if (recording || state.busy || uploadBusy) { e.preventDefault(); e.returnValue = ''; } });
setInterval(() => { const el = $('#session-clock'); if (el && !el.dataset.end) el.textContent = elapsed(Date.now() - Date.parse(el.dataset.start)); }, 1000);
async function boot() {
  const savedServer = localStorage.getItem('study-server-id');
  if (savedServer) await initSync(savedServer, syncChanged);
  try { await refresh(); }
  catch (error) {
    if (window.StudyNative) return pairDialog();
    if (error.status === 401) return adminLoginDialog();
    const cached = localStorage.getItem('study-snapshot');
    if (cached) { state.data = JSON.parse(cached); state.offline = true; if (!state.data.courses.some(c => c.id === state.courseId)) state.courseId = state.data.courses[0]?.id; state.view = 'notes'; render(); }
    else $('#app').innerHTML = `<div class="loading-screen">无法连接学习服务，请确认 npm start 正在运行。<p class="hint">${escape(error.message)}</p><a href="/">重新连接</a></div>`;
  }
  if ('serviceWorker' in navigator && window.isSecureContext && !window.StudyNative) navigator.serviceWorker.register('/sw.js').catch(() => {});
  flush();
  handleOverlayAction();
}
window.addEventListener('study-native-inbox', () => { if (state.data) toast('收到手机分享或录音，可在「连接与进度」收取。'); });
window.addEventListener('study-overlay-action', () => { handleOverlayAction(); });
boot();
