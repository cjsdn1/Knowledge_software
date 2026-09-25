import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// 删除与级联规则的唯一真源：在线路由（server.mjs）与离线同步（lib/sync.mjs）共用，
// 否则同一次删除在两条路径上会得到不同结果。
//
// 调用方负责事务：/api/sync 已在外层包了 store.transaction，内部再开 BEGIN IMMEDIATE 会抛错。
const TOMBSTONE_LIMIT = 500;

export function createRemoval({ store, uploadsDirectory }) {
  // 实体与 tombstone 共用 records 表且主键同为 id，而 upsert 只更新同 kind 的行，
  // 所以必须先删掉实体行，再写入 tombstone，否则写入会被静默忽略。
  const forget = (kind, id) => {
    const removed = store.remove(kind, id);
    if (removed) {
      store.put('tombstones', { id, entity: kind, deletedAt: new Date().toISOString() });
      for (const stale of store.all('tombstones').slice(TOMBSTONE_LIMIT)) store.remove('tombstones', stale.id);
    }
    return removed;
  };

  const referencedBy = documentId => {
    const match = value => value?.documentId === documentId;
    const notes = store.all('notes').filter(n => match(n.source));
    const runs = store.all('runs').filter(r => match(r.source));
    const events = store.all('events').filter(e => match(e.source));
    return { notes, runs, events, counts: { notes: notes.length, runs: runs.length, events: events.length } };
  };

  const fileInUse = fileId => {
    if (!fileId) return false;
    if (store.all('documents').some(d => d.fileId === fileId)) return true;
    if (store.all('events').some(e => e.fileId === fileId)) return true;
    if (store.all('runs').some(r => r.imageFileId === fileId)) return true;
    return store.all('notes').some(n => (n.content || '').includes(`/api/files/${fileId}`));
  };

  // 绝不留下“有行无文件”：/api/files/:id 会直接 readFileSync 该路径。
  const dropFile = fileId => {
    if (!fileId || fileInUse(fileId)) return;
    store.remove('files', fileId);
    const path = join(uploadsDirectory, fileId);
    if (existsSync(path)) unlinkSync(path);
  };

  const removeNote = id => {
    for (const session of store.all('sessions').filter(s => s.noteId === id)) store.put('sessions', { ...session, noteId: null });
    for (const run of store.all('runs').filter(r => r.noteId === id)) store.put('runs', { ...run, noteId: null });
    return { ok: forget('notes', id), id };
  };

  const removeCard = id => {
    for (const run of store.all('runs').filter(r => (r.cardIds || []).includes(id))) store.put('runs', { ...run, cardIds: run.cardIds.filter(c => c !== id) });
    return { ok: forget('cards', id), id };
  };

  const removeWorkflow = id => ({ ok: forget('workflows', id), id });

  const removeRun = id => {
    const run = store.get('runs', id);
    if (!run) return { ok: false, id };
    if (run.status === 'running') throw Object.assign(new Error('该任务仍在运行，请先取消再删除。'), { status: 409 });
    if (store.all('jobs').some(j => j.runId === id && ['queued', 'running'].includes(j.status))) throw Object.assign(new Error('该任务仍在电脑队列中，请先取消再删除。'), { status: 409 });
    return { ok: forget('runs', id), id };
  };

  // refs: block（有引用则拒绝，由调用方判断）| detach（切断引用、保留文件）| cascade（连同引用一起删）
  const removeDocument = (id, refs = 'block') => {
    const document = store.get('documents', id);
    if (!document) return { ok: false, id };
    const { notes, runs, events } = referencedBy(id);
    if (refs === 'cascade') {
      for (const note of notes) removeNote(note.id);
      for (const run of runs) forget('runs', run.id);
      for (const event of events) forget('events', event.id);
    } else if (refs === 'detach') {
      for (const note of notes) store.put('notes', { ...note, source: null });
      for (const run of runs) store.put('runs', { ...run, source: null });
      for (const event of events) store.put('events', { ...event, source: null });
    }
    forget('documents', id);
    // detach 有意保留 files 行与磁盘字节：笔记正文里还嵌着 [查看原图](/api/files/<id>)。
    if (refs !== 'detach') dropFile(document.fileId);
    return { ok: true, id, refs };
  };

  const courseContent = courseId => {
    const count = kind => store.all(kind).filter(record => record.courseId === courseId).length;
    return { documents: count('documents'), notes: count('notes'), cards: count('cards'), sessions: count('sessions'), events: count('events'), runs: count('runs') };
  };

  const removeCourse = (id, { cascade = false, target } = {}) => {
    if (!store.get('courses', id)) return { ok: false, id };
    if (cascade) {
      for (const document of store.all('documents').filter(d => d.courseId === id)) removeDocument(document.id, 'cascade');
      for (const kind of ['notes', 'cards', 'sessions', 'events', 'runs']) {
        for (const record of store.all(kind).filter(r => r.courseId === id)) forget(kind, record.id);
      }
    } else if (target) {
      for (const kind of ['documents', 'notes', 'cards', 'sessions', 'events', 'runs']) {
        for (const record of store.all(kind).filter(r => r.courseId === id)) store.put(kind, { ...record, courseId: target });
      }
    }
    forget('courses', id);
    return { ok: true, id };
  };

  return { referencedBy, fileInUse, dropFile, courseContent, removeNote, removeCard, removeWorkflow, removeRun, removeDocument, removeCourse };
}