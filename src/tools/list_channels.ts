import { getToken } from "../auth.js";
import { makeDiscordHeaders, rateLimitedFetch } from "../ratelimit.js";

export async function listChannels(guildId: string) {
  const token = await getToken();
  const res = await rateLimitedFetch(
    `https://discord.com/api/v10/guilds/${guildId}/channels`,
    { headers: makeDiscordHeaders(token) }
  );
  if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
  const channels = await res.json() as Array<{
    id: string; name: string; type: number; topic: string | null;
  }>;
  // type 0 = GUILD_TEXT, type 5 = GUILD_ANNOUNCEMENT
  return channels
    .filter(c => c.type === 0 || c.type === 5)
    .map(c => ({ id: c.id, name: c.name, topic: c.topic }));
}
