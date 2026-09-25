const $ = selector => document.querySelector(selector);
const tools = [
  ['explain', '解释', '解', '读懂这一段', '开始解释'],
  ['translate', '翻译', '译', '双语对照与点词', '生成双语对照'],
  ['summarize', '整理重点', '重', '提炼关键内容', '整理重点'],
  ['cards', '复习卡片', '卡', '翻面复习', '生成卡片'],
  ['formula', '公式识别与解释', '∑', '符号与推导', '解释公式'],
  ['code', '代码解释', '</>', '逐行读懂代码', '解释代码'],
  ['dictionary', '词典', '词', '单词与例句', '查询词典'],
  ['calculator', '计算器', '=', '按键与算式', '保存计算结果'],
  ['note', '保存笔记', '记', '归档到课程', '保存到课程']
].map(([id, name, mark, detail, action]) => ({ id, name, mark, detail, action }));
let selectedTool = tools[0], files = [], hasScreenshot = false, pending = [];
let galleryFile = null, galleryUrl = '', protectedScenario = false;
const state = { depth: '简明', summary: '三条重点', from: '英语', to: '中文', flipped: false, language: 'JavaScript', calc: '', answer: '', noteTitle: '随手拾起的知识点' };
const menu = $('#tool-menu'), trigger = $('#tool-trigger'), workspace = $('#tool-workspace'), scroll = $('#overlay-scroll');
function setMenu(open) { menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); }
function clearPending() { pending.forEach(clearTimeout); pending = []; }
function renderTools() {
  menu.replaceChildren();
  for (const tool of tools) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tool-option'; button.role = 'option';
    button.setAttribute('aria-selected', String(tool === selectedTool));
    button.innerHTML = '<span class="tool-mark"></span><span><strong></strong><small></small></span>';
    button.querySelector('.tool-mark').textContent = tool.mark;
    button.querySelector('strong').textContent = tool.name;
    button.querySelector('small').textContent = tool.detail;
    if (tool === selectedTool) button.insertAdjacentHTML('beforeend', '<svg><use href="#i-check"/></svg>');
    button.addEventListener('click', () => { clearPending(); selectedTool = tool; $('#tool-name').textContent = tool.name; $('#result-card').hidden = true; $('#process-button').disabled = false; renderTools(); renderWorkspace(); setMenu(false); scroll.scrollTop = 0; trigger.focus(); });
    menu.append(button);
  }
}
const choice = (action, values, active) => `<div class="choice-row">${values.map(value => `<button type="button" class="choice${value === active ? ' active' : ''}" data-action="${action}" data-value="${value}" aria-pressed="${value === active}">${value}</button>`).join('')}</div>`;
const heading = title => `<div class="workspace-heading"><strong>${title}</strong></div>`;
const wordBank = [
  ['Knowledge', '/ˈnɒlɪdʒ/', '名词 · 知识；学问'], ['grows', '/ɡrəʊz/', '动词 · 增长；发展'],
  ['when', '/wen/', '连词 · 当……时'], ['ideas', '/aɪˈdɪəz/', '名词 · 观点；想法'], ['connect', '/kəˈnekt/', '动词 · 联系；连接']
];
function bilingualView() {
  const english = `<div class="language-card"><small>英语</small><p>${wordBank.map(([word], index) => `<button class="word-button" type="button" data-word="${index}">${word}</button>`).join(' ')}.</p></div>`;
  const chinese = '<div class="language-card translated"><small>中文</small><p>当想法产生联系，知识便会增长。</p></div>';
  return `<div class="bilingual-grid">${state.from === '英语' ? english + chinese : chinese + english}</div>`;
}
function renderWorkspace() {
  const id = selectedTool.id;
  $('#process-label').textContent = selectedTool.action;
  $('#input-label').textContent = ({ translate: '原文', calculator: '补充说明', note: '笔记正文', code: '代码', dictionary: '单词或短语' })[id] || '输入内容';
  $('#input-text').placeholder = '输入、粘贴，或添加图片与文档';
  const views = {
    explain: `${heading('理解方式', '选择解释深度')}${choice('depth', ['简明', '逐步', '举例'], state.depth)}<div class="mini-flow"><span>原文</span><b>→</b><span>核心意思</span><b>→</b><span>举例</span></div>`,
    translate: `${heading('双语翻译', '点词查看词义')}<div class="language-switch"><span>${state.from}</span><button type="button" data-action="swap" aria-label="交换语言">⇄</button><span>${state.to}</span></div>${bilingualView()}<div class="word-detail" id="word-detail" aria-live="polite">轻点英文单词，查看词义与发音。</div><button class="inline-action" type="button" data-action="sample">使用示例原文</button>`,
    summarize: `${heading('整理方式', '按所选结构呈现')}${choice('summary', ['三条重点', '逐段梳理', '知识结构'], state.summary)}<div class="outline-preview"><span>01</span><p>关键结论</p><span>02</span><p>原因与依据</p><span>03</span><p>值得记住的例子</p></div>`,
    cards: `${heading('复习卡片', '轻点卡片翻面')}<button class="flashcard" type="button" data-action="flip"><small>${state.flipped ? '背面 · 答案' : '正面 · 问题'}</small><strong>${state.flipped ? '导数表示函数在某一点的瞬时变化率。' : '导数描述了什么？'}</strong><span>轻点${state.flipped ? '返回问题' : '查看答案'} ↗</span></button><p class="workspace-note">示例卡片 · 正式版本由输入内容生成</p>`,
    formula: `${heading('公式工作台', '识别 → 符号 → 推导')}<div class="formula-face"><small>示例公式</small><strong>f′(x) = lim<sub>h→0</sub> [f(x+h) − f(x)] / h</strong></div><div class="formula-tags"><span>f′(x) · 导数</span><span>h → 0 · 趋近于零</span></div>`,
    code: `${heading('代码阅读', '逐行定位说明')}${choice('language', ['JavaScript', 'Python'], state.language)}<div class="code-face"><span>01</span><code>${state.language === 'Python' ? 'def double(x):' : 'function double(x) {'}</code><span>02</span><code>${state.language === 'Python' ? '    return x * 2' : '  return x * 2;'}</code>${state.language === 'Python' ? '' : '<span>03</span><code>}</code>'}</div>`,
    dictionary: `${heading('词典卡片', '词性 · 发音 · 例句')}<div class="dictionary-face"><small>今日示例</small><strong>connect <span>/kəˈnekt/</span></strong><p>v. 连接；建立联系</p><div>Ideas connect across subjects.<br><em>不同学科的想法相互关联。</em></div></div>`,
    calculator: `${heading('计算器', '直接按键或输入算式')}<div class="calculator"><div class="calc-screen"><span id="calc-answer"></span><input id="calc-display" inputmode="decimal" autocomplete="off" aria-label="计算表达式" placeholder="0"></div><div class="calc-keys">${['C', '(', ')', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+'].map(key => `<button type="button" class="calc-key${'+−×÷='.includes(key) ? ' operator' : ''}" data-key="${key}">${key}</button>`).join('')}</div></div>`,
    note: `${heading('保存位置', '结果留在悬浮窗内')}<div class="note-location"><span>课程</span><strong>我的第一门课</strong><span>›</span></div><label class="note-title-label" for="note-title">笔记标题</label><input class="note-title" id="note-title" maxlength="60" placeholder="输入笔记标题"><p class="workspace-note">处理后显示笔记预览，并模拟同步到课程。</p>`
  };
  workspace.innerHTML = views[id];
  if (id === 'calculator') { $('#calc-display').value = state.calc; $('#calc-answer').textContent = state.answer || '按 = 计算'; }
  if (id === 'note') $('#note-title').value = state.noteTitle;
}
function calculate(expression) {
  const text = expression.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s/g, '');
  if (!text || /[^\d.+\-*/()]/.test(text)) throw Error('请输入有效算式');
  let i = 0;
  const number = () => {
    if (text[i] === '(') { i++; const value = sum(); if (text[i++] !== ')') throw Error('括号未配对'); return value; }
    if (text[i] === '+' || text[i] === '-') { const sign = text[i++] === '-' ? -1 : 1; return sign * number(); }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(i));
    if (!match) throw Error('算式不完整'); i += match[0].length; return Number(match[0]);
  };
  const product = () => { let value = number(); while (text[i] === '*' || text[i] === '/') { const op = text[i++], right = number(); value = op === '*' ? value * right : value / right; } return value; };
  const sum = () => { let value = product(); while (text[i] === '+' || text[i] === '-') { const op = text[i++], right = product(); value = op === '+' ? value + right : value - right; } return value; };
  const value = sum(); if (i !== text.length) throw Error('算式不完整'); if (!Number.isFinite(value)) throw Error('除数不能为零');
  return Number(value.toPrecision(12)).toString();
}
function pressCalc(key) {
  if (key === 'C') { state.calc = ''; state.answer = ''; }
  else if (key === '⌫') { state.calc = state.calc.slice(0, -1); state.answer = ''; }
  else if (key === '=') { try { state.answer = calculate(state.calc); } catch (error) { state.answer = error.message; } }
  else { state.calc += key; state.answer = ''; }
  $('#calc-display').value = state.calc; $('#calc-answer').textContent = state.answer || '按 = 计算';
}
workspace.addEventListener('input', event => {
  if (event.target.id === 'calc-display') { state.calc = event.target.value; state.answer = ''; $('#calc-answer').textContent = '按 = 计算'; }
  if (event.target.id === 'note-title') state.noteTitle = event.target.value;
});
workspace.addEventListener('keydown', event => { if (event.target.id === 'calc-display' && event.key === 'Enter') { event.preventDefault(); pressCalc('='); } });
workspace.addEventListener('click', event => {
  const word = event.target.closest('[data-word]');
  if (word) { const [text, phonetic, meaning] = wordBank[Number(word.dataset.word)]; $('#word-detail').textContent = `${text}  ${phonetic}  ${meaning}`; workspace.querySelectorAll('[data-word]').forEach(item => item.classList.toggle('selected', item === word)); return; }
  const key = event.target.closest('[data-key]'); if (key) { pressCalc(key.dataset.key); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const { action, value } = button.dataset;
  if (action === 'depth') state.depth = value;
  if (action === 'summary') state.summary = value;
  if (action === 'language') state.language = value;
  if (action === 'swap') [state.from, state.to] = [state.to, state.from];
  if (action === 'flip') state.flipped = !state.flipped;
  if (action === 'sample') $('#input-text').value = state.from === '英语' ? 'Knowledge grows when ideas connect.' : '当想法产生联系，知识便会增长。';
  else renderWorkspace();
});
function renderAttachments() {
  const holder = $('#attachments'); holder.replaceChildren();
  const items = [...files.map((file, index) => ({ name: file.name, index, kind: 'file' }))];
  if (hasScreenshot) items.push({ name: '当前屏幕 · 选区', kind: 'screen' });
  for (const item of items) {
    const chip = document.createElement('span'); chip.className = 'attachment';
    const name = document.createElement('span'); name.textContent = item.name;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', '移除' + item.name);
    remove.addEventListener('click', () => { if (item.kind === 'screen') hasScreenshot = false; else files.splice(item.index, 1); renderAttachments(); });
    chip.append(name, remove); holder.append(chip);
  }
}
function showResult(status, body, sync) {
  $('#result-card').hidden = false; $('#result-status').textContent = status; $('#result-body').textContent = body; $('#result-sync').textContent = sync;
  scroll.scrollTop = scroll.scrollHeight;
}
function renderResult(id) {
  const examples = {
    explain: [[`${state.depth}解释`, '导数表示某一点的瞬时变化快慢。'], ['关键一步', '比较输入发生很小变化时，输出变化的比例。'], ['举例', '像速度表显示某一刻的速度。']],
    translate: state.from === '英语' ? [['原文 · 英语', 'Knowledge grows when ideas connect.'], ['译文 · 中文', '当想法产生联系，知识便会增长。']] : [['原文 · 中文', '当想法产生联系，知识便会增长。'], ['译文 · 英语', 'Knowledge grows when ideas connect.']],
    summarize: [[state.summary, '01 · 导数衡量瞬时变化'], ['02', '极限是定义的关键'], ['03', 'x² 的导数是 2x']],
    cards: [['复习卡 · 1 / 3', '问：导数表示什么？'], ['答案', '函数在某一点附近的瞬时变化率。']],
    formula: [['识别到的公式', 'f′(x) = lim h→0 [f(x+h) − f(x)] / h'], ['含义', '让增量 h 逐渐接近零，得到瞬时变化率。']],
    code: [[`${state.language} · 逐行解释`, '01 · 接收参数 x'], ['02', '计算 x × 2 并返回。']],
    dictionary: [['connect /kəˈnekt/ · 动词', '连接；建立联系'], ['例句', 'Ideas connect across subjects. 不同学科的想法相互关联。']],
    calculator: [['计算记录', `${state.calc} = ${state.answer}`]],
    note: [['我的第一门课 · 笔记预览', state.noteTitle.trim() || '未命名笔记'], ['正文', $('#input-text').value.trim().slice(0, 120) || '示例：记录一个新的知识点。']]
  };
  const stack = document.createElement('div'); stack.className = 'output-stack';
  for (const [label, content] of examples[id]) { const row = document.createElement('div'), small = document.createElement('small'), strong = document.createElement('strong'); small.textContent = label; strong.textContent = content; row.append(small, strong); stack.append(row); }
  $('#result-detail').replaceChildren(stack);
}
function startProcessing() {
  clearPending(); setMenu(false);
  const input = $('#input-text').value.trim(), id = selectedTool.id;
  if (id === 'calculator') {
    try { state.answer = calculate(state.calc); $('#calc-answer').textContent = state.answer; }
    catch (error) { showResult('待输入', error.message, '尚未保存'); $('#result-detail').replaceChildren(); $('#copy-button').hidden = true; return; }
  } else if (!input && !files.length && !hasScreenshot && !galleryFile) {
    showResult('待输入', '输入文字或添加图片、文档。', ''); $('#result-detail').replaceChildren(); $('#copy-button').hidden = true; return;
  }
  const source = [hasScreenshot ? '当前屏幕选区' : '', ...files.map(file => file.name), input].filter(Boolean).join(' · ');
  $('#process-button').disabled = true; $('#copy-button').hidden = true; $('#copy-label').textContent = '复制结果'; $('#result-detail').replaceChildren();
  showResult('处理中', '正在生成结果…', '');
  pending.push(setTimeout(() => {
    if (id !== selectedTool.id) return;
    showResult('已完成', id === 'calculator' ? '本地计算结果' : '示例结果', '同步中（演示）');
    renderResult(id); $('#copy-button').hidden = false; $('#process-button').disabled = false; scroll.scrollTop = scroll.scrollHeight;
    pending.push(setTimeout(() => { $('#result-sync').textContent = '✓ 已归入当前课程（演示）'; }, 650));
  }, 700));
}
trigger.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('pointerdown', event => { if (!$('#tool-field').contains(event.target)) setMenu(false); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { setMenu(false); $('#crop-card').hidden = true; } });
$('#file-input').addEventListener('change', event => { files = [...files, ...event.target.files].slice(0, 8); renderAttachments(); event.target.value = ''; });
$('#file-button').addEventListener('click', () => $('#file-input').click());
$('#screen-button').addEventListener('click', () => { setMenu(false); $('#protected-notice').hidden = !protectedScenario; $('#crop-card').hidden = protectedScenario; scroll.scrollTo({ top: scroll.scrollHeight, behavior: 'smooth' }); });
function openGallery() { $('#gallery-input').click(); }
$('#gallery-button').addEventListener('click', openGallery);
$('#protected-gallery').addEventListener('click', openGallery);
$('#unclear-capture').addEventListener('click', () => { $('#protected-notice').hidden = false; $('#crop-card').hidden = true; });
$('#protected-demo').addEventListener('click', () => {
  protectedScenario = !protectedScenario;
  $('#protected-demo').setAttribute('aria-pressed', String(protectedScenario));
  $('#protected-notice').hidden = !protectedScenario;
  $('#crop-card').hidden = true; showPanel(true);
  if (protectedScenario) $('#protected-notice').scrollIntoView({ block: 'nearest' });
});
$('#surface-toggle').addEventListener('click', () => {
  const app = $('#phone').classList.toggle('app-surface');
  $('#surface-toggle').textContent = app ? '应用内' : '悬浮窗'; showPanel(true);
});
$('#gallery-input').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { showResult('无法打开', '请选择图片文件。', ''); return; }
  const url = URL.createObjectURL(file), preview = new Image(); preview.src = url;
  try {
    await preview.decode();
    if (galleryUrl) URL.revokeObjectURL(galleryUrl);
    galleryFile = file; galleryUrl = url; $('#gallery-image').src = url;
    $('#gallery-meta').textContent = `${preview.naturalWidth} × ${preview.naturalHeight} · 原图`;
    $('#gallery-preview').hidden = false; $('#protected-notice').hidden = true; $('#crop-card').hidden = true;
    $('#gallery-preview').scrollIntoView({ block: 'nearest' });
  } catch { URL.revokeObjectURL(url); showResult('无法预览', '请改选 JPEG、PNG 或 WebP 图片。', ''); }
});
$('#remove-gallery').addEventListener('click', () => {
  if (galleryUrl) URL.revokeObjectURL(galleryUrl);
  galleryFile = null; galleryUrl = ''; $('#gallery-image').removeAttribute('src'); $('#gallery-preview').hidden = true;
});
$('#cancel-crop').addEventListener('click', () => { $('#crop-card').hidden = true; });
$('#confirm-crop').addEventListener('click', () => { hasScreenshot = true; renderAttachments(); $('#crop-card').hidden = true; startProcessing(); });
$('#process-button').addEventListener('click', startProcessing);
$('#copy-button').addEventListener('click', async () => { try { await navigator.clipboard.writeText([$('#result-body').textContent, $('#result-detail').textContent].join('\n')); $('#copy-label').textContent = '已复制结果'; } catch { $('#copy-label').textContent = '复制未完成'; } });
function showPanel(show) { $('#overlay').hidden = !show; $('#orb').setAttribute('aria-expanded', String(show)); $('#orb').setAttribute('aria-label', show ? '收起拾知悬浮窗' : '打开拾知悬浮窗'); $('#phone').classList.toggle('panel-closed', !show); }
$('#orb').addEventListener('click', () => showPanel($('#overlay').hidden));
$('#minimize').addEventListener('click', () => showPanel(false));
const sample = $('#sample-screen'), selection = $('#sample-selection'); let start = null;
function samplePoint(event) { const rect = sample.getBoundingClientRect(); return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)), width: rect.width, height: rect.height }; }
sample.addEventListener('pointerdown', event => { start = samplePoint(event); sample.setPointerCapture(event.pointerId); });
sample.addEventListener('pointermove', event => { if (!start) return; const point = samplePoint(event), x = Math.min(start.x, point.x), y = Math.min(start.y, point.y); Object.assign(selection.style, { left: x / point.width * 100 + '%', top: y / point.height * 100 + '%', width: Math.abs(start.x - point.x) / point.width * 100 + '%', height: Math.abs(start.y - point.y) / point.height * 100 + '%' }); });
sample.addEventListener('pointerup', event => { if (!start) return; const point = samplePoint(event); if (Math.abs(point.x - start.x) < 12 || Math.abs(point.y - start.y) < 12) selection.removeAttribute('style'); start = null; });
sample.addEventListener('pointercancel', () => { start = null; selection.removeAttribute('style'); });
const themeModes = ['system', 'light', 'dark']; let themeIndex = 0;
$('#theme-toggle').addEventListener('click', () => { themeIndex = (themeIndex + 1) % themeModes.length; const mode = themeModes[themeIndex]; if (mode === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = mode; $('#theme-toggle').textContent = '配色：' + ({ system: '跟随系统', light: '浅色', dark: '深色' })[mode]; });
renderTools(); renderWorkspace();
