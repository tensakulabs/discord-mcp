import { getToken } from "../auth.js";
import { makeDiscordHeaders, rateLimitedFetch } from "../ratelimit.js";

interface SendOptions {
  channelId?: string;    // send to guild channel directly
  userId?: string;       // open/reuse DM with user
  content: string;
  replyToMessageId?: string;
}

export async function sendMessage(opts: SendOptions) {
  const token = await getToken();

  let targetChannelId = opts.channelId;

  // If userId given, open DM channel first
  if (!targetChannelId && opts.userId) {
    const dmRes = await rateLimitedFetch(
      "https://discord.com/api/v10/users/@me/channels",
      {
        method: "POST",
        headers: makeDiscordHeaders(token),
        body: JSON.stringify({ recipient_id: opts.userId }),
      }
    );
    if (!dmRes.ok) throw new Error(`Failed to open DM: ${dmRes.status}`);
    const dm = await dmRes.json() as { id: string };
    targetChannelId = dm.id;
  }

  if (!targetChannelId) throw new Error("Must provide channelId or userId");

  const body: Record<string, unknown> = { content: opts.content };
  if (opts.replyToMessageId) {
    body.message_reference = { message_id: opts.replyToMessageId };
  }

  const res = await rateLimitedFetch(
    `https://discord.com/api/v10/channels/${targetChannelId}/messages`,
    {
      method: "POST",
      headers: makeDiscordHeaders(token),
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Failed to send: ${res.status} — ${JSON.stringify(err)}`);
  }
  const msg = await res.json() as { id: string; timestamp: string };
  return { messageId: msg.id, timestamp: msg.timestamp, channelId: targetChannelId };
}
