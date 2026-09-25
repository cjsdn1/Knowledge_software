// 工作台各工具的专属界面：纯函数 + 一份界面状态，供 app.js 使用。
// 这里只描述“工具怎么用”的结构，不产生任何模型结果；真实结果一律来自后端的 run。

export const toolState = { depth: '简明', summary: '三条重点', from: '英语', to: '中文', language: 'JavaScript', flipped: false, calc: '', answer: '', wordDetail: '' };

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const heading = title => `<div class="workspace-heading"><strong>${esc(title)}</strong></div>`;
const choice = (action, values, active) => `<div class="choice-row">${values.map(value => `<button type="button" class="choice${value === active ? ' active' : ''}" data-wb-choice="${action}" data-value="${esc(value)}" aria-pressed="${value === active}">${esc(value)}</button>`).join('')}</div>`;
const flow = steps => `<div class="mini-flow">${steps.map((step, index) => `${index ? '<b>→</b>' : ''}<span>${esc(step)}</span>`).join('')}</div>`;
const KEYPAD = ['C', '(', ')', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', '=', '+'];

export function toolLabels(toolId) {
  return ({ translate: '原文', calculator: '算式', save: '笔记正文', code: '代码', dictionary: '单词或短语', ocr: '图片或文字' })[toolId] || '学习材料';
}

// 与悬浮窗原型一致的本地解析器：只做四则运算，不执行任何用户代码。
export function calcLocal(expression) {
  const text = String(expression).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s/g, '');
  if (!text || /[^\d.+\-*/()]/.test(text)) throw new Error('请输入有效算式');
  let at = 0;
  const number = () => {
    if (text[at] === '(') { at++; const value = sum(); if (text[at++] !== ')') throw new Error('括号未配对'); return value; }
    if (text[at] === '+' || text[at] === '-') { const sign = text[at++] === '-' ? -1 : 1; return sign * number(); }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(at));
    if (!match) throw new Error('算式不完整'); at += match[0].length; return Number(match[0]);
  };
  const product = () => { let value = number(); while (text[at] === '*' || text[at] === '/') { const op = text[at++], right = number(); value = op === '*' ? value * right : value / right; } return value; };
  const sum = () => { let value = product(); while (text[at] === '+' || text[at] === '-') { const op = text[at++], right = product(); value = op === '+' ? value + right : value - right; } return value; };
  const value = sum();
  if (at !== text.length) throw new Error('算式不完整');
  if (!Number.isFinite(value)) throw new Error('除数不能为零');
  return Number(value.toPrecision(12)).toString();
}

const cardsPanel = card => card
  ? `${heading('复习卡片')}<button class="flashcard" type="button" data-wb-flip><small>${toolState.flipped ? '背面 · 答案' : '正面 · 问题'}</small><strong>${esc(toolState.flipped ? card.answer : card.question)}</strong><span>轻点${toolState.flipped ? '返回问题' : '查看答案'} ↗</span></button><p class="workspace-note">显示最近创建的一张卡片；全部卡片在下方信息流。</p>`
  : `${heading('复习卡片')}<p class="workspace-note">当前课程还没有卡片。输入材料后运行「复习卡片」，由模型生成问答题库。</p>`;

const dictionaryPanel = last => last
  ? `${heading('词典卡片')}<div class="dictionary-face"><small>最近一次查询</small><strong>${esc(last.word)}</strong><p>${esc(last.meaning)}</p></div>`
  : `${heading('词典卡片')}<p class="workspace-note">内置小词库，可离线查询；运行后最近一条释义显示在这里。</p>`;

const panels = ctx => ({
  ocr: `${heading('图像识别')}${flow(['图片或截图', '识别原文', '保留结构'])}<p class="workspace-note">需要支持图像输入的模型。可在课件里圈选后提问，或用随手记截图后处理。</p>`,
  explain: `${heading('理解方式')}${choice('depth', ['简明', '逐步', '举例'], toolState.depth)}${flow(['原文', '核心意思', '举例'])}`,
  translate: `${heading('双语方向')}<div class="language-switch"><span>${esc(toolState.from)}</span><button type="button" data-wb-swap aria-label="交换语言">⇄</button><span>${esc(toolState.to)}</span></div><div class="word-detail" id="wb-word" aria-live="polite">${toolState.wordDetail ? esc(toolState.wordDetail) : '运行后在下方结果里点英文单词，可查词义。'}</div>`,
  summarize: `${heading('整理结构')}${choice('summary', ['三条重点', '逐段梳理', '知识结构'], toolState.summary)}<div class="outline-preview"><span>01</span><p>关键结论</p><span>02</span><p>原因与依据</p><span>03</span><p>值得记住的例子</p></div>`,
  cards: cardsPanel(ctx.card),
  formula: `${heading('公式工作台')}${flow(['识别公式', '符号含义', '推导条件'])}<p class="workspace-note">运行后在这里查看识别到的公式与符号说明。</p>`,
  code: `${heading('代码阅读')}${choice('language', ['JavaScript', 'Python'], toolState.language)}${flow(['逐行逻辑', '输入输出', '边界情况'])}`,
  dictionary: dictionaryPanel(ctx.dictionary),
  calculator: `${heading('计算器')}<div class="calculator"><div class="calc-screen"><span id="wb-calc-answer">${esc(toolState.answer || '按 = 计算')}</span><input id="wb-calc-display" inputmode="decimal" autocomplete="off" aria-label="计算表达式" placeholder="0" value="${esc(toolState.calc)}"></div><div class="calc-keys">${KEYPAD.map(key => `<button type="button" class="calc-key${'+−×÷='.includes(key) ? ' operator' : ''}" data-wb-key="${esc(key)}">${esc(key)}</button>`).join('')}</div></div>`,
  note: `${heading('归档位置')}<div class="note-location"><span>课程</span><strong>${esc(ctx.courseName || '当前课程')}</strong></div><label class="note-title-label" for="wb-title">笔记标题</label><input class="note-title" id="wb-title" maxlength="60" placeholder="输入笔记标题" value="${esc(ctx.noteTitle || '')}">`
});

// 插件 id「save」在原型里叫「note」，只差这一处命名映射。
const PANEL_IDS = { save: 'note' };
export function toolWorkspace(toolId, ctx = {}) {
  const views = panels(ctx);
  return `<div class="wb-workspace">${views[PANEL_IDS[toolId] || toolId] || views.explain}</div>`;
}

export function toolAction(action, value) {
  if (action === 'depth') toolState.depth = value;
  else if (action === 'summary') toolState.summary = value;
  else if (action === 'language') toolState.language = value;
  else if (action === 'swap') [toolState.from, toolState.to] = [toolState.to, toolState.from];
  else if (action === 'flip') toolState.flipped = !toolState.flipped;
}

export function calculatorKey(key) {
  if (key === 'C') { toolState.calc = ''; toolState.answer = ''; }
  else if (key === '⌫') { toolState.calc = toolState.calc.slice(0, -1); toolState.answer = ''; }
  else if (key === '=') { try { toolState.answer = calcLocal(toolState.calc); } catch (error) { toolState.answer = error.message; } }
  else { toolState.calc += key; toolState.answer = ''; }
  return toolState;
}

// 结果里的拉丁词包成可点按钮：点后查真实的内置词典，而不是本地示意词表。
export const decorateWords = value => esc(value).replace(/[A-Za-z][A-Za-z'’-]{2,}/g, word => `<button type="button" class="word-button" data-wb-word="${word}">${word}</button>`);