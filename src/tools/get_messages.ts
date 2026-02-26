import { getDb, queryMessages } from "../db.js";
import { getToken } from "../auth.js";
import { makeDiscordHeaders, rateLimitedFetch } from "../ratelimit.js";
import { markSeen } from "../state.js";
import { loadConfig } from "../config.js";

export async function getMessages(
  channelId: string,
  limit = 25,
  since?: string,   // ISO date string e.g. "2026-02-25" or "2026-02-25T00:00:00Z"
  until?: string
) {
  const sinceMs = since ? new Date(since).getTime() : undefined;
  const untilMs = until ? new Date(until).getTime() : undefined;

  // ISC-D4: SQLite-first
  const db = getDb();
  if (db) {
    const rows = queryMessages(db, channelId, limit, sinceMs, untilMs);
    if (rows.length > 0) {
      if (rows.length > 0) markSeen(channelId, rows[0].timestamp);
      return rows.map(r => ({
        id: r.id,
        author: r.author_name,
        content: r.content,
        timestamp: new Date(r.timestamp).toISOString(),
      }));
    }
  }

  // ISC-D4: REST fallback on miss
  const config = loadConfig();
  if (!config.retention.fallback_to_api) {
    return []; // privacy mode — no REST fallback
  }

  const token = await getToken();
  let url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`;
  const res = await rateLimitedFetch(url, { headers: makeDiscordHeaders(token) });
  if (!res.ok) throw new Error(`Discord API error: ${res.status}`);

  const messages = await res.json() as Array<{
    id: string; content: string;
    author: { username: string };
    timestamp: string;
    referenced_message?: { content: string };
  }>;

  if (messages.length > 0) {
    const latestTs = new Date(messages[0].timestamp).getTime();
    markSeen(channelId, latestTs);
  }

  return messages.map(m => ({
    id: m.id,
    author: m.author.username,
    content: m.content,
    timestamp: m.timestamp,
    replyTo: m.referenced_message?.content,
  }));
}
