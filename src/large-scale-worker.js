'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parentPort, workerData } = require('worker_threads');
const { DatabaseSync } = require('node:sqlite');

const cancelled = new Set();
parentPort.on('message', message => { if (message?.type === 'cancel') cancelled.add(message.id); });
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));
const safeRoot = value => path.resolve(String(value || ''));

function database() {
  fs.mkdirSync(path.dirname(workerData.database), { recursive: true });
  const db = new DatabaseSync(workerData.database); db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, root TEXT NOT NULL, name TEXT NOT NULL, extension TEXT, bytes INTEGER, modified_ms INTEGER, signature TEXT, indexed_at TEXT); CREATE INDEX IF NOT EXISTS idx_files_root_name ON files(root,name); CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);'); return db;
}

async function indexFiles(job) {
  const root = safeRoot(job.root); const stat = fs.statSync(root); if (!stat.isDirectory()) throw new Error('Scale index requires a directory');
  const db = database(); const upsert = db.prepare('INSERT INTO files(path,root,name,extension,bytes,modified_ms,signature,indexed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET root=excluded.root,name=excluded.name,extension=excluded.extension,bytes=excluded.bytes,modified_ms=excluded.modified_ms,signature=excluded.signature,indexed_at=excluded.indexed_at');
  const stack = [root]; let files = 0; let directories = 0; let bytes = 0; let skipped = 0; const maxFiles = Math.max(1, Math.min(5_000_000, Number(job.maxFiles) || 1_000_000)); const started = Date.now();
  try {
    while (stack.length && files < maxFiles) {
      if (cancelled.has(job.id)) return { cancelled: true, files, directories, bytes };
      const directory = stack.pop(); let entries; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { skipped++; continue; } directories++;
      db.exec('BEGIN'); try { for (const entry of entries) { const target = path.join(directory, entry.name); if (entry.isDirectory()) { if (!entry.isSymbolicLink()) stack.push(target); continue; } if (!entry.isFile()) continue; let item; try { item = fs.statSync(target); } catch { skipped++; continue; } const signature = crypto.createHash('sha256').update(`${item.size}:${item.mtimeMs}:${target}`).digest('hex'); upsert.run(target, root, entry.name, path.extname(entry.name).toLowerCase(), item.size, Math.trunc(item.mtimeMs), signature, new Date().toISOString()); files++; bytes += item.size; if (files >= maxFiles) break; } db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
      if (directories % 20 === 0) { parentPort.postMessage({ type: 'progress', id: job.id, files, directories, bytes, queuedDirectories: stack.length }); await yieldLoop(); }
    }
    db.prepare('DELETE FROM files WHERE root=? AND indexed_at < ?').run(root, new Date(started).toISOString());
    return { cancelled: false, root, files, directories, bytes, skipped, capped: files >= maxFiles, durationMs: Date.now() - started, durable: true, backend: 'sqlite-wal' };
  } finally { db.close(); cancelled.delete(job.id); }
}

function search(job) {
  const db = database(); try { const query = String(job.query || '').slice(0, 500); const root = job.root ? safeRoot(job.root) : ''; const limit = Math.max(1, Math.min(500, Number(job.limit) || 100)); const escaped = `%${query.replace(/[\\%_]/g, value => `\\${value}`)}%`; const rows = root ? db.prepare("SELECT path,name,extension,bytes,modified_ms AS modifiedMs FROM files WHERE root=? AND (name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?").all(root, escaped, escaped, limit) : db.prepare("SELECT path,name,extension,bytes,modified_ms AS modifiedMs FROM files WHERE name LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?").all(escaped, escaped, limit); return { query, root, rows, count: rows.length, bounded: true, durable: true, backend: 'sqlite-wal' }; } finally { db.close(); }
}

parentPort.on('message', async job => { if (!job?.id || !job.action) return; try { const result = job.action === 'index' ? await indexFiles(job) : job.action === 'search' ? search(job) : (() => { throw new Error('Unknown scale worker action'); })(); parentPort.postMessage({ type: 'result', id: job.id, result }); } catch (error) { parentPort.postMessage({ type: 'error', id: job.id, error: error.message }); } });
