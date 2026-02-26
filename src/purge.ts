import { getDb, deleteOlderThan } from "./db.js";
import { loadConfig } from "./config.js";

export function runPurge(): void {
  const db = getDb();
  if (!db) return;

  const config = loadConfig();
  const now = Date.now();

  const guildCutoff = now - config.retention.guild_channels * 24 * 60 * 60 * 1000;
  const dmCutoff    = now - config.retention.dms           * 24 * 60 * 60 * 1000;
  const mentionCutoff = now - config.retention.mentioned   * 24 * 60 * 60 * 1000;

  // Purge guild messages (not DM, not mention)
  deleteOlderThan(db, guildCutoff, false, false);
  // Purge DMs
  deleteOlderThan(db, dmCutoff, true, false);
  // Purge mentions
  deleteOlderThan(db, mentionCutoff, false, true);
  // DM mentions use the more conservative of dm/mention retention (dm wins)
  deleteOlderThan(db, dmCutoff, true, true);

  console.error(`[discord-mcp] Purge complete.`);
}

export function schedulePurge(): void {
  // Run at next 2am, then every 24h
  const now = new Date();
  const next2am = new Date(now);
  next2am.setHours(2, 0, 0, 0);
  if (next2am <= now) next2am.setDate(next2am.getDate() + 1);

  const msUntil2am = next2am.getTime() - now.getTime();
  setTimeout(() => {
    runPurge();
    setInterval(runPurge, 24 * 60 * 60 * 1000);
  }, msUntil2am);
}
