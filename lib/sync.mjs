import { randomUUID } from 'node:crypto';
const check = (ok, text, status = 400) => { if (!ok) throw Object.assign(new Error(text), { status }); };
const text = (value, length = 10000) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
export function createSync(store, removal) {
  const get = (kind, id) => { const value = store.get(kind, id); check(value, '关联记录不存在。', 404); return value; };
  const source = (value, courseId) => {
    if (!value?.documentId) return null;
    const doc = get('documents', value.documentId), page = Number(value.page);
    check(doc.courseId === courseId && Number.isInteger(page) && page > 0 && page <= doc.pages.length, '来源课程或页码无效。');
    return { documentId: doc.id, name: doc.name, page };
  };
  return operation => {
    const { kind, payload: p = {} } = operation, now = new Date().toISOString();
    const entityId = operation.entityId || operation.id; check(validId(entityId), '实体 ID 无效。');
    const pref = get('settings', 'preferences');
    if (kind === 'note.create' || kind === 'card.create') {
      get('courses', p.courseId);
      if (kind === 'note.create') {
        check(text(p.content, 150000), '笔记内容不能为空。'); check(!store.get('notes', entityId), '笔记 ID 已存在。', 409);
        // tombstone 防止离线设备用同一个 id 把电脑端已删的笔记重新创建回来。
        check(!store.get('tombstones', entityId), '该笔记已在电脑端删除，请另存为新笔记。', 409);
        return store.put('notes', { id: entityId, courseId: p.courseId, title: text(p.title, 150) || '离线笔记', content: text(p.content, 150000), source: source(p.source, p.courseId), tags: ['随手记'], ...(validId(p.overlayJobId) ? { overlayJobId: p.overlayJobId } : {}), createdAt: now, updatedAt: now });
      }
      check(text(p.question, 2000) && text(p.answer, 8000), '卡片需要问题与答案。'); check(!store.get('cards', entityId), '卡片 ID 已存在。', 409);
      check(!store.get('tombstones', entityId), '该卡片已在电脑端删除，请新建卡片。', 409);
      return store.put('cards', { id: entityId, courseId: p.courseId, question: text(p.question, 2000), answer: text(p.answer, 8000), createdAt: now, dueAt: now, interval: 0, reviews: 0 });
    }
    if (kind === 'note.update') {
      const note = get('notes', entityId); check(p.baseUpdatedAt === note.updatedAt, '电脑或其他设备已修改此笔记。离线版本仍保留，可另存为新笔记。', 409);
      check(text(p.content, 150000), '笔记内容不能为空。');
      return store.put('notes', { ...note, title: text(p.title, 150) || note.title, content: text(p.content, 150000), updatedAt: new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1)).toISOString() });
    }
    if (kind === 'card.review') {
      const card = get('cards', entityId); check(p.baseReviews === card.reviews, '卡片已在另一设备复习，请刷新后重新评分。', 409);
      check(['again', 'good', 'easy'].includes(p.rating), '评分无效。');
      const days = p.rating === 'again' ? 0 : p.rating === 'easy' ? Math.max(4, card.interval * 3) : Math.max(1, card.interval * 2);
      return store.put('cards', { ...card, interval: days, reviews: card.reviews + 1, dueAt: new Date(Date.now() + (days ? days * 86400000 : 600000)).toISOString() });
    }
    if (kind === 'note.delete' || kind === 'card.delete') {
      check(pref.mode !== 'exam', '考试模式禁止修改学习记录。', 403);
      const record = store.get(kind === 'note.delete' ? 'notes' : 'cards', entityId);
      // 重放同一次删除必须无害：实体已不在，但有 tombstone 时按幂等成功返回。
      if (!record) { check(store.get('tombstones', entityId), '记录不存在。', 404); return { ok: true, id: entityId, alreadyDeleted: true }; }
      const stale = kind === 'note.delete' ? p.baseUpdatedAt !== record.updatedAt : p.baseReviews !== record.reviews;
      check(!stale, kind === 'note.delete' ? '电脑或其他设备已修改此笔记，离线删除未执行。' : '卡片已在另一设备修改，离线删除未执行。', 409);
      return kind === 'note.delete' ? removal.removeNote(entityId) : removal.removeCard(entityId);
    }
    if (kind === 'card.update') {
      check(pref.mode !== 'exam', '考试模式禁止修改学习记录。', 403);
      const card = get('cards', entityId); check(p.baseReviews === card.reviews, '卡片已在另一设备修改，请刷新后重试。', 409);
      check(text(p.question, 2000) && text(p.answer, 8000), '卡片需要问题与答案。');
      return store.put('cards', { ...card, question: text(p.question, 2000), answer: text(p.answer, 8000), updatedAt: now });
    }
    check(pref.mode !== 'exam', '考试模式禁止同步课堂记录。', 403);
    if (kind === 'session.start') {
      get('courses', p.courseId); check(!store.all('sessions').some(s => !s.endedAt), '电脑端已有进行中的课堂，离线课堂暂缓同步。', 409);
      check(!store.get('sessions', entityId), '课堂 ID 已存在。', 409);
      const start = Date.parse(p.startedAt); check(Number.isFinite(start) && start <= Date.now() + 300000, '课堂开始时间无效，请检查手机时间。');
      store.put('settings', { ...pref, mode: 'classroom' });
      return store.put('sessions', { id: entityId, courseId: p.courseId, title: text(p.title, 120) || '离线课堂', startedAt: new Date(start).toISOString(), createdAt: now, endedAt: null });
    }
    if (kind === 'event.create') {
      const session = get('sessions', p.sessionId); check(['重点', '疑问', '页码', '板书', '圈选', '录音', '文字'].includes(p.type), '事件类型无效。');
      check(!store.get('events', entityId), '事件已存在。', 409);
      const at = Date.parse(p.capturedAt), start = Date.parse(session.startedAt), end = session.endedAt ? Date.parse(session.endedAt) : Date.now() + 300000;
      check(Number.isFinite(at) && at >= start && at <= end, '事件时间超出课堂范围。');
      if (p.fileId) get('files', p.fileId);
      const durationMs = Number(p.durationMs || 0); check(Number.isFinite(durationMs) && durationMs >= 0 && durationMs <= 360000, '录音长度无效。');
      const event = store.put('events', { id: entityId, sessionId: session.id, courseId: session.courseId, type: p.type, text: text(p.text), fileId: p.fileId || null, source: source(p.source, session.courseId), offsetMs: at - start, durationMs, createdAt: now });
      if (session.noteId) {
        const note = get('notes', session.noteId);
        store.put('notes', { ...note, content: note.content + `\n\n离线补充 [${Math.floor(event.offsetMs / 60000)} 分钟] ${event.type}：${event.text}${event.fileId ? ` [附件](/api/files/${event.fileId})` : ''}`, updatedAt: now });
      }
      return event;
    }
    if (kind === 'session.end') {
      const session = get('sessions', entityId); if (session.endedAt) return session;
      const end = Date.parse(p.endedAt); check(Number.isFinite(end) && end >= Date.parse(session.startedAt) && end <= Date.now() + 300000, '课堂结束时间无效。');
      const events = store.all('events').filter(e => e.sessionId === session.id).sort((a, b) => a.offsetMs - b.offsetMs);
      check(events.every(e => Date.parse(session.startedAt) + e.offsetMs <= end), '结束时间早于已记录事件。');
      const content = `# ${session.title}\n\n` + events.map(e => `- [${Math.floor(e.offsetMs / 60000)}:${String(Math.floor(e.offsetMs / 1000) % 60).padStart(2, '0')}] ${e.type}：${e.text}${e.source ? `（${e.source.name} 第 ${e.source.page} 页）` : ''}${e.fileId ? ` [附件](/api/files/${e.fileId})` : ''}`).join('\n') + '\n\n## 待确认疑问\n' + (events.filter(e => e.type === '疑问').map(e => '- ' + e.text).join('\n') || '未标记疑问。');
      const note = store.put('notes', { id: randomUUID(), courseId: session.courseId, title: session.title + ' · 课堂笔记', content, sessionId: session.id, tags: ['课堂'], createdAt: now, updatedAt: now });
      if (pref.mode === 'classroom') store.put('settings', { ...pref, mode: 'study' });
      return store.put('sessions', { ...session, endedAt: new Date(end).toISOString(), noteId: note.id });
    }
    throw new Error('不支持的离线操作。');
  };
}
