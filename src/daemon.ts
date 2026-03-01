#!/usr/bin/env node
/**
 * discord-mcp daemon
 * Connects to Discord Gateway via WebSocket, ingests messages into SQLite.
 * Run as a launchd service (com.discord-mcp.daemon).
 */
import { WebSocket } from "ws";
import { getToken } from "./auth.js";
import { initDb, insertMessage } from "./db.js";
import { schedulePurge } from "./purge.js";
import { loadConfig } from "./config.js";
import { fireHooks } from "./hooks.js";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const IDENTIFY_INTENTS = (1 << 0) | (1 << 9) | (1 << 12); // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT
const ACCOUNT = process.env.DISCORD_MCP_ACCOUNT ?? "default";

let ws: WebSocket | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let sequence: number | null = null;
let sessionId: string | null = null;
let resumeGatewayUrl: string | null = null;
let reconnectDelay = 1000;
let selfId: string | null = null; // set from READY event

const db = initDb(ACCOUNT);
schedulePurge(ACCOUNT);

async function connect(resume = false): Promise<void> {
  const token = await getToken(ACCOUNT);
  const url = resume && resumeGatewayUrl ? resumeGatewayUrl : GATEWAY_URL;

  ws = new WebSocket(url);

  ws.on("open", () => {
    reconnectDelay = 1000; // reset on successful connect
    console.error("[discord-mcp daemon] Connected to gateway.");
  });

  ws.on("message", (data: Buffer) => {
    const payload = JSON.parse(data.toString()) as GatewayPayload;
    if (payload.s) sequence = payload.s;

    switch (payload.op) {
      case 10: // HELLO
        startHeartbeat(payload.d.heartbeat_interval as number);
        if (resume && sessionId) {
          send({ op: 6, d: { token, session_id: sessionId, seq: sequence } }); // RESUME
        } else {
          identify(token);
        }
        break;

      case 11: // HEARTBEAT_ACK
        break;

      case 1: // HEARTBEAT request
        sendHeartbeat();
        break;

      case 7: // RECONNECT
        reconnect(true);
        break;

      case 9: // INVALID SESSION
        sessionId = null;
        setTimeout(() => reconnect(false), 1000 + Math.random() * 4000);
        break;

      case 0: // DISPATCH
        handleEvent(payload.t!, payload.d);
        break;
    }
  });

  ws.on("close", (code) => {
    clearHeartbeat();
    console.error(`[discord-mcp daemon] Disconnected (${code}). Reconnecting in ${reconnectDelay}ms...`);
    setTimeout(() => reconnect(code !== 1000), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });

  ws.on("error", (err) => {
    console.error("[discord-mcp daemon] WebSocket error:", err.message);
  });
}

function identify(token: string): void {
  send({
    op: 2,
    d: {
      token,
      intents: IDENTIFY_INTENTS,
      properties: { os: "linux", browser: "discord-mcp", device: "discord-mcp" },
    },
  });
}

function handleEvent(type: string, data: Record<string, unknown>): void {
  switch (type) {
    case "READY":
      sessionId = data.session_id as string;
      resumeGatewayUrl = data.resume_gateway_url as string;
      selfId = (data.user as { id: string } | undefined)?.id ?? null;
      console.error(`[discord-mcp daemon] Ready. (selfId: ${selfId})`);
      break;

    case "MESSAGE_CREATE": {
      const msg = data as unknown as DiscordMessage;
      if (msg.author?.bot) break; // ignore bots

      // Detect mention type
      const isDirect = selfId !== null && Array.isArray(msg.mentions) &&
        msg.mentions.some((u: { id: string }) => u.id === selfId);
      const isEveryone = msg.mention_everyone === true &&
        msg.content.includes("@everyone");
      const isHere = msg.mention_everyone === true &&
        msg.content.includes("@here");

      const mentionType = isDirect ? "direct"
        : isEveryone ? "everyone"
        : isHere ? "here"
        : null;

      insertMessage(db, {
        id:           msg.id,
        channel_id:   msg.channel_id,
        guild_id:     msg.guild_id ?? null,
        author_id:    msg.author.id,
        author_name:  msg.author.username,
        content:      msg.content,
        timestamp:    new Date(msg.timestamp).getTime(),
        is_dm:        msg.guild_id ? 0 : 1,
        is_mention:   mentionType !== null ? 1 : 0,
        mention_type: mentionType,
      });

      // Fire hooks
      const cfg = loadConfig(ACCOUNT);
      const ctx = {
        author:  msg.author.username,
        content: msg.content,
        channel: msg.channel_id,
        guild:   msg.guild_id ?? "dm",
        is_dm:   !msg.guild_id,
      };
      if (isDirect)   fireHooks(cfg.hooks.on_mention, ctx);
      if (isEveryone) fireHooks(cfg.hooks.on_everyone, ctx);
      if (isHere)     fireHooks(cfg.hooks.on_here, ctx);
      fireHooks(cfg.hooks.on_message, ctx);
      break;
    }
  }
}

function startHeartbeat(intervalMs: number): void {
  clearHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, intervalMs);
}

function clearHeartbeat(): void {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

function sendHeartbeat(): void {
  send({ op: 1, d: sequence });
}

function send(payload: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function reconnect(resume: boolean): void {
  ws?.terminate();
  ws = null;
  connect(resume);
}

// Types
interface GatewayPayload {
  op: number;
  d: Record<string, unknown>;
  s: number | null;
  t: string | null;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: { id: string; username: string; bot?: boolean };
  content: string;
  timestamp: string;
  mentions: Array<{ id: string }>;
  mention_everyone: boolean;
}

// Start
connect(false);
