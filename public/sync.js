import { request, newId, sha256 } from './transport.js';
let db, serverId, flushing = false, listener = () => {};
const completion = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('本机存储失败')); });
export async function initSync(id, onChange) {
  if (serverId === id && db) { if (onChange) listener = onChange; return; }
  if (flushing) throw new Error('同步进行中，请稍后切换电脑。');
  db?.close(); serverId = id; if (onChange) listener = onChange;
  db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('study-device-' + id, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('outbox', { keyPath: 'id' }); open.result.createObjectStore('meta'); };
    open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error);
  });
  localStorage.setItem('study-server-id', id);
}
async function put(item) { const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').put(item); await completion(tx); listener(); return item; }
export async function entries() {
  if (!db) return [];
  return new Promise((resolve, reject) => { const req = db.transaction('outbox').objectStore('outbox').getAll(); req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt.localeCompare(b.createdAt))); req.onerror = () => reject(req.error); });
}
export async function snapshot(value) {
  if (!db) return null;
  if (value !== undefined) { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(value, 'snapshot'); await completion(tx); return value; }
  return new Promise((resolve, reject) => { const req = db.transaction('meta').objectStore('meta').get('snapshot'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export async function queueOperation(kind, payload, entityId, dependency) {
  const id = newId(); return put({ id, serverId, type: 'operation', name: payload.title || payload.text || payload.question || kind, operation: { id, kind, entityId: entityId || id, payload }, dependency, status: 'pending', createdAt: new Date().toISOString() });
}
export async function queueUpload(blob, options) {
  if (!blob.size || blob.size > 20 * 1024 * 1024) throw new Error('文件应为 1 字节至 20 MB。');
  const id = options.id || newId(), existing = (await entries()).find(e => e.id === id);
  if (existing) return existing;
  const checksum = await sha256(await blob.arrayBuffer());
  return put({ id, serverId, type: 'upload', name: options.name || blob.name || '附件', blob, upload: { clientId: id, kind: options.kind || 'document', courseId: options.courseId, name: options.name || blob.name || '附件', size: blob.size, mime: (options.mime || blob.type).split(';')[0], sha256: checksum }, status: 'pending', progress: 0, createdAt: new Date().toISOString() });
}
export async function queueJob(payload) { const id = newId(); return put({ id, serverId, type: 'job', name: payload.request || '学习任务', payload, status: 'pending', progress: 0, createdAt: new Date().toISOString() }); }
const base64 = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
export async function flush() {
  if (!db || flushing) return; flushing = true;
  try {
    // Confirm destination identity before sending any private payload or attachment.
    const info = await request('/connection'); if (info.serverId !== serverId) throw new Error('电脑身份已改变，已暂停同步。请重新配对。');
    for (const item of await entries()) {
      if (item.status !== 'pending' && item.status !== 'sending') continue;
      try {
        item.status = 'sending'; await put(item);
        if (item.type === 'upload') {
          const upload = await request('/uploads', item.upload);
          if (upload.status === 'done') item.result = upload.result;
          else {
            const total = Math.ceil(item.blob.size / upload.chunkSize);
            for (let i = 0; i < total; i++) {
              if (!upload.received.includes(i)) await request(`/uploads/${upload.id}/chunks/${i}`, { data: await base64(item.blob.slice(i * upload.chunkSize, Math.min(item.blob.size, (i + 1) * upload.chunkSize))) }, 'PUT');
              item.progress = Math.round((i + 1) / total * 95); await put(item);
            }
            item.result = await request(`/uploads/${upload.id}/complete`, {});
          }
          // Release the large local blob only after durable server completion was acknowledged.
          delete item.blob; item.status = 'done'; item.progress = 100;
        } else if (item.type === 'operation') {
          if (item.dependency) {
            const parent = (await entries()).find(e => e.id === item.dependency);
            if (!parent || parent.status !== 'done') { item.status = 'pending'; await put(item); continue; }
            item.operation.payload.fileId = parent.result.id;
            if (item.operation.payload.content) item.operation.payload.content = item.operation.payload.content.replaceAll('/api/files/pending:' + item.dependency, '/api/files/' + parent.result.id);
          }
          item.result = await request('/sync', item.operation); item.status = 'done';
        } else {
          item.result = await request('/jobs', { clientId: item.id, payload: item.payload }); item.status = 'submitted'; delete item.payload;
        }
        delete item.error; await put(item);
      } catch (error) {
        // Validation/auth/conflict errors require user action; transport failures retry later.
        item.status = error.status && error.status < 500 && error.status !== 429 ? 'blocked' : 'pending'; item.error = error.message; await put(item);
        if (!error.status || error.status === 401 || error.status >= 500) break;
      }
    }
    for (const item of (await entries()).filter(e => e.type === 'job' && ['submitted', 'running'].includes(e.status))) {
      try { item.result = await request('/jobs/' + item.id); item.progress = item.result.progress; item.status = ['done', 'failed', 'cancelled', 'interrupted'].includes(item.result.status) ? item.result.status : 'submitted'; await put(item); } catch (error) { item.error = error.message; await put(item); }
    }
  } catch (error) { listener(error); } finally { flushing = false; }
}
export async function retryEntry(id) {
  const item = (await entries()).find(e => e.id === id); if (!item) return;
  if (item.type === 'job' && ['failed', 'cancelled', 'interrupted'].includes(item.status)) { item.result = await request('/jobs/' + id + '/retry', {}); item.status = 'submitted'; }
  else { item.status = 'pending'; delete item.error; }
  await put(item); return flush();
}
export async function cancelEntry(id) {
  const item = (await entries()).find(e => e.id === id); if (!item) return;
  if (item.type === 'job' && item.status === 'submitted') item.result = await request('/jobs/' + id + '/cancel', {});
  if (item.status === 'sending') throw new Error('传输进行中，请稍后取消。');
  item.status = 'cancelled'; await put(item);
}
// 彻底移除一条排队项：用于撤销从未上传过的操作，避免留下「已取消」的幽灵记录。
export async function discardEntry(id) {
  const tx = db.transaction('outbox', 'readwrite'); tx.objectStore('outbox').delete(id); await completion(tx); listener();
}
export async function preserveConflict(id) {
  const item = (await entries()).find(e => e.id === id); if (!['note.update', 'note.create'].includes(item?.operation?.kind)) return;
  await queueOperation('note.create', { ...item.operation.payload, title: item.operation.payload.title + ' · 离线副本' });
  item.status = 'cancelled'; await put(item); return flush();
}
export function overlay(data, outbox) {
  const copy = structuredClone(data);
  for (const item of outbox.filter(e => ['pending', 'sending', 'blocked'].includes(e.status) && e.type === 'operation')) {
    const { kind, payload: p, entityId } = item.operation;
    const base = { ...p, id: entityId, createdAt: item.createdAt, updatedAt: p.baseUpdatedAt || item.createdAt, pending: true };
    const update = (type, entity) => { const at = copy[type].findIndex(e => e.id === entityId); if (at < 0) copy[type].unshift(entity); else copy[type][at] = { ...copy[type][at], ...entity }; };
    if (kind === 'note.create' || kind === 'note.update') update('notes', base);
    if (kind === 'note.delete') copy.notes = copy.notes.filter(n => n.id !== entityId);
    if (kind === 'card.create') update('cards', { ...base, reviews: 0, interval: 0, dueAt: item.createdAt });
    if (kind === 'card.update') update('cards', base);
    if (kind === 'card.delete') copy.cards = copy.cards.filter(c => c.id !== entityId);
    if (kind === 'card.review') { const card = copy.cards.find(c => c.id === entityId); if (card) card.dueAt = new Date(Date.now() + 600000).toISOString(); }
    if (kind === 'session.start') { update('sessions', { ...base, endedAt: null }); copy.preferences.mode = 'classroom'; }
    if (kind === 'session.end') { const s = copy.sessions.find(s => s.id === entityId); if (s) { s.endedAt = p.endedAt; copy.preferences.mode = 'study'; } }
    if (kind === 'event.create') { const s = copy.sessions.find(s => s.id === p.sessionId); if (s) update('events', { ...base, courseId: s.courseId, offsetMs: Date.parse(p.capturedAt) - Date.parse(s.startedAt) }); }
  }
  return copy;
}
window.addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
setInterval(() => { if (!document.hidden) flush(); }, 10000);
// Keep active model jobs responsive while the app is visible; idle devices retain the slower sync cadence.
setInterval(async () => {
  if (document.hidden || !db || flushing) return;
  const items = await entries();
  if (items.some(e => e.type === 'job' && ['submitted', 'running'].includes(e.status))) flush();
}, 2000);
