import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createStore(directory) {
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'study.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS records_kind ON records(kind);');
  const all = kind => db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.body));
  const get = (kind, id) => {
    const row = db.prepare('SELECT body FROM records WHERE id=? AND kind=?').get(id, kind);
    return row ? JSON.parse(row.body) : null;
  };
  const put = (kind, record) => {
    db.prepare('INSERT INTO records(id,kind,body) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE kind=excluded.kind').run(record.id, kind, JSON.stringify(record));
    return record;
  };
  const add = (kind, data) => put(kind, { ...data, id: randomUUID(), createdAt: new Date().toISOString() });
  if (!get('settings', 'preferences')) put('settings', { id: 'preferences', mode: 'study', network: false, disabledPlugins: [], autoSave: true });
  if (!all('courses').length) add('courses', { name: '我的第一门课', color: 'sage' });
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const remove = (kind, id) => db.prepare('DELETE FROM records WHERE id=? AND kind=?').run(id, kind).changes > 0;
  return { all, get, put, add, remove, transaction, close: () => db.close() };
}
