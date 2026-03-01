import { getToken } from "../auth.js";
import { makeDiscordHeaders, rateLimitedFetch } from "../ratelimit.js";

export async function listGuilds(account = "default") {
  const token = await getToken(account);
  const res = await rateLimitedFetch(
    "https://discord.com/api/v10/users/@me/guilds",
    { headers: makeDiscordHeaders(token) }
  );
  if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
  const guilds = await res.json() as Array<{ id: string; name: string; icon: string | null }>;
  return guilds.map(g => ({ id: g.id, name: g.name }));
}
