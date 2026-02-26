import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");
const DB_FILE = join(CONFIG_DIR, "messages.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database | null {
  if (_db) return _db;
  if (!existsSync(DB_FILE)) return null; // ISC-A5: graceful miss

  try {
    _db = new Database(DB_FILE);
    // ISC-A4: WAL mode prevents corruption on crash
    _db.pragma("journal_mode = WAL");
    _db.pragma("synchronous = NORMAL");
    return _db;
  } catch {
    return null;
  }
}

export function initDb(): Database.Database {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      channel_id  TEXT NOT NULL,
      guild_id    TEXT,
      author_id   TEXT NOT NULL,
      author_name TEXT NOT NULL,
      content     TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,  -- unix ms
      is_dm       INTEGER NOT NULL DEFAULT 0,
      is_mention  INTEGER NOT NULL DEFAULT 0,
      seen        INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_channel_ts ON messages(channel_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_seen ON messages(seen, timestamp DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      author_name,
      content='messages',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, author_name)
      VALUES (new.rowid, new.content, new.author_name);
    END;
  `);

  _db = db;
  return db;
}

export interface DbMessage {
  id: string;
  channel_id: string;
  guild_id: string | null;
  author_id: string;
  author_name: string;
  content: string;
  timestamp: number;
  is_dm: number;
  is_mention: number;
  seen: number;
}

export function insertMessage(db: Database.Database, msg: Omit<DbMessage, "seen">): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO messages
      (id, channel_id, guild_id, author_id, author_name, content, timestamp, is_dm, is_mention, seen)
    VALUES
      (@id, @channel_id, @guild_id, @author_id, @author_name, @content, @timestamp, @is_dm, @is_mention, 0)
  `);
  stmt.run(msg);
}

export function queryMessages(
  db: Database.Database,
  channelId: string,
  limit: number,
  since?: number,
  until?: number
): DbMessage[] {
  let sql = "SELECT * FROM messages WHERE channel_id = ?";
  const params: (string | number)[] = [channelId];
  if (since) { sql += " AND timestamp >= ?"; params.push(since); }
  if (until) { sql += " AND timestamp <= ?"; params.push(until); }
  sql += " ORDER BY timestamp DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params) as DbMessage[];
}

export function queryUnread(db: Database.Database): DbMessage[] {
  return db.prepare(
    "SELECT * FROM messages WHERE seen = 0 ORDER BY timestamp ASC"
  ).all() as DbMessage[];
}

export function markAllSeen(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE messages SET seen = 1 WHERE id IN (${placeholders})`).run(...ids);
}

export function searchMessages(
  db: Database.Database,
  query: string,
  channelId?: string,
  since?: number,
  until?: number,
  limit = 50
): DbMessage[] {
  // FTS5 search
  let sql = `
    SELECT m.* FROM messages m
    JOIN messages_fts f ON m.rowid = f.rowid
    WHERE messages_fts MATCH ?
  `;
  const params: (string | number)[] = [query];
  if (channelId) { sql += " AND m.channel_id = ?"; params.push(channelId); }
  if (since) { sql += " AND m.timestamp >= ?"; params.push(since); }
  if (until) { sql += " AND m.timestamp <= ?"; params.push(until); }
  sql += " ORDER BY m.timestamp DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params) as DbMessage[];
}

export function deleteOlderThan(db: Database.Database, cutoffMs: number, isDm: boolean, isMention: boolean): void {
  db.prepare(`
    DELETE FROM messages
    WHERE timestamp < ?
      AND is_dm = ?
      AND is_mention = ?
  `).run(cutoffMs, isDm ? 1 : 0, isMention ? 1 : 0);
}
