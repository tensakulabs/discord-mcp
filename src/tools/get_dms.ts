import { getToken } from "../auth.js";
import { makeDiscordHeaders, rateLimitedFetch } from "../ratelimit.js";

export async function getDMChannels() {
  const token = await getToken();
  const res = await rateLimitedFetch(
    "https://discord.com/api/v10/users/@me/channels",
    { headers: makeDiscordHeaders(token) }
  );
  if (!res.ok) throw new Error(`Discord API error: ${res.status}`);
  const channels = await res.json() as Array<{
    id: string; type: number;
    recipients: Array<{ id: string; username: string }>;
    last_message_id: string | null;
  }>;
  // type 1 = DM, type 3 = GROUP_DM
  return channels
    .filter(c => c.type === 1 || c.type === 3)
    .map(c => ({
      channelId: c.id,
      with: c.recipients.map(r => r.username).join(", "),
      lastMessageId: c.last_message_id,
    }));
}
