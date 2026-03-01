import { getDb, queryUnread, markAllSeen } from "../db.js";
import { getToken } from "../auth.js";
import { makeDiscordHeaders, rateLimitedFetch } from "../ratelimit.js";
import { getLastSeen, markSeen } from "../state.js";
import { loadConfig } from "../config.js";

interface MonitoredChannel {
  guildName: string;
  channelName: string;
  channelId: string;
}

export async function getUnread(channels: MonitoredChannel[], account = "default") {
  // ISC-D4: SQLite-first path
  const db = getDb(account);
  if (db) {
    const unreadRows = queryUnread(db);
    if (unreadRows.length > 0) {
      // Group by channel
      const grouped: Record<string, typeof unreadRows> = {};
      for (const row of unreadRows) {
        if (!grouped[row.channel_id]) grouped[row.channel_id] = [];
        grouped[row.channel_id].push(row);
      }

      markAllSeen(db, unreadRows.map(r => r.id));

      return Object.entries(grouped).map(([channelId, msgs]) => {
        const ch = channels.find(c => c.channelId === channelId);
        return {
          guild: ch?.guildName ?? "Unknown",
          channel: ch?.channelName ?? channelId,
          channelId,
          messages: msgs.map(m => ({
            id: m.id,
            author: m.author_name,
            content: m.content,
            timestamp: new Date(m.timestamp).toISOString(),
          })),
        };
      });
    }
  }

  // REST fallback (daemon not running or no unread in SQLite)
  const config = loadConfig(account);
  if (!config.retention.fallback_to_api) return [];

  const token = await getToken(account);
  const results = [];

  for (const ch of channels) {
    const lastSeen = getLastSeen(ch.channelId, account);
    const res = await rateLimitedFetch(
      `https://discord.com/api/v10/channels/${ch.channelId}/messages?limit=25`,
      { headers: makeDiscordHeaders(token) }
    );
    if (!res.ok) continue;

    const messages = await res.json() as Array<{
      id: string; content: string;
      author: { username: string; bot?: boolean };
      timestamp: string;
    }>;

    const unread = messages
      .filter(m => !m.author.bot && new Date(m.timestamp).getTime() > lastSeen)
      .reverse();

    if (unread.length > 0) {
      markSeen(ch.channelId, new Date(messages[0].timestamp).getTime(), account);
      results.push({
        guild: ch.guildName,
        channel: ch.channelName,
        channelId: ch.channelId,
        messages: unread.map(m => ({
          id: m.id,
          author: m.author.username,
          content: m.content,
          timestamp: m.timestamp,
        })),
      });
    }
  }

  return results;
}
