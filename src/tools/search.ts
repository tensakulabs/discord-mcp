import { getDb, searchMessages } from "../db.js";

export async function searchDiscord(
  query: string,
  channelId?: string,
  since?: string,
  until?: string,
  limit = 50
) {
  const db = getDb();
  if (!db) {
    throw new Error("Daemon not running — no local message history to search. Start discord-mcp daemon first.");
  }

  const sinceMs = since ? new Date(since).getTime() : undefined;
  const untilMs = until ? new Date(until).getTime() : undefined;

  const rows = searchMessages(db, query, channelId, sinceMs, untilMs, limit);

  return rows.map(r => ({
    id: r.id,
    author: r.author_name,
    content: r.content,
    channel_id: r.channel_id,
    timestamp: new Date(r.timestamp).toISOString(),
    is_dm: r.is_dm === 1,
    is_mention: r.is_mention === 1,
  }));
}
