import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { listGuilds } from "./tools/list_guilds.js";
import { listChannels } from "./tools/list_channels.js";
import { getMessages } from "./tools/get_messages.js";
import { getDMChannels } from "./tools/get_dms.js";
import { sendMessage } from "./tools/send_message.js";
import { getUnread } from "./tools/get_unread.js";
import { searchDiscord } from "./tools/search.js";
import { resolveDmUser } from "./tools/resolve_dm_user.js";

const ACCOUNT = process.env.DISCORD_MCP_ACCOUNT ?? "default";

// Each account gets its own MCP server name → unique tool namespace in Claude Code.
// Override with DISCORD_MCP_NAME env var to decouple the public namespace from the local account name.
const SERVER_NAME = process.env.DISCORD_MCP_NAME ?? (ACCOUNT === "default" ? "discord" : `discord-${ACCOUNT}`);

const server = new Server(
  { name: SERVER_NAME, version: "0.1.8" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "discord_list_guilds",
      description: "List all Discord servers (guilds) the user is a member of.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "discord_list_channels",
      description: "List text channels in a guild.",
      inputSchema: {
        type: "object",
        properties: {
          guildId: { type: "string", description: "Guild ID from discord_list_guilds" },
        },
        required: ["guildId"],
      },
    },
    {
      name: "discord_get_messages",
      description: "Get messages from a channel. Uses local cache if daemon is running, Discord API otherwise.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string" },
          limit: { type: "number", default: 25, description: "Max messages (1-100)" },
          since: { type: "string", description: "ISO date or datetime e.g. '2026-02-25' or 'yesterday'" },
          until: { type: "string", description: "ISO date or datetime upper bound" },
        },
        required: ["channelId"],
      },
    },
    {
      name: "discord_get_dms",
      description: "List the user's open DM conversations.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "discord_resolve_dm_user",
      description: "Resolve a username or display name to a DM channel ID. Use this before discord_get_messages when you know who to DM but not the channel ID.",
      inputSchema: {
        type: "object",
        properties: {
          username: { type: "string", description: "Display name or username to look up (case-insensitive, partial match supported)" },
        },
        required: ["username"],
      },
    },
    {
      name: "discord_send_message",
      description: "Send a message to a channel or user (DM). Specify channelId OR userId.",
      inputSchema: {
        type: "object",
        properties: {
          channelId: { type: "string", description: "Guild channel ID" },
          userId: { type: "string", description: "User ID to DM" },
          content: { type: "string", description: "Message text" },
          replyToMessageId: { type: "string", description: "Optional message ID to reply to" },
        },
        required: ["content"],
      },
    },
    {
      name: "discord_get_unread",
      description: "Get messages you haven't seen yet. Uses local cache when daemon is running.",
      inputSchema: {
        type: "object",
        properties: {
          channels: {
            type: "array",
            description: "Channels to check.",
            items: {
              type: "object",
              properties: {
                guildName: { type: "string" },
                channelName: { type: "string" },
                channelId: { type: "string" },
              },
              required: ["guildName", "channelName", "channelId"],
            },
          },
        },
        required: ["channels"],
      },
    },
    {
      name: "discord_search",
      description: "Full-text search across locally cached Discord messages (requires daemon).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search terms" },
          channelId: { type: "string", description: "Limit to a specific channel (optional)" },
          since: { type: "string", description: "ISO date lower bound (optional)" },
          until: { type: "string", description: "ISO date upper bound (optional)" },
          limit: { type: "number", default: 50, description: "Max results" },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let result: unknown;
    switch (name) {
      case "discord_list_guilds":
        result = await listGuilds(ACCOUNT); break;
      case "discord_list_channels":
        result = await listChannels((args as { guildId: string }).guildId, ACCOUNT); break;
      case "discord_get_messages": {
        const a = args as { channelId: string; limit?: number; since?: string; until?: string };
        result = await getMessages(a.channelId, a.limit, a.since, a.until, ACCOUNT); break;
      }
      case "discord_get_dms":
        result = await getDMChannels(ACCOUNT); break;
      case "discord_resolve_dm_user":
        result = await resolveDmUser((args as { username: string }).username, ACCOUNT); break;
      case "discord_send_message":
        result = await sendMessage(args as {
          channelId?: string; userId?: string;
          content: string; replyToMessageId?: string;
        }, ACCOUNT); break;
      case "discord_get_unread":
        result = await getUnread(
          (args as { channels: Array<{ guildName: string; channelName: string; channelId: string }> }).channels,
          ACCOUNT
        ); break;
      case "discord_search": {
        const a = args as { query: string; channelId?: string; since?: string; until?: string; limit?: number };
        result = await searchDiscord(a.query, a.channelId, a.since, a.until, a.limit, ACCOUNT); break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const isTokenMissing = detail.includes("No Discord token found");
    const errorPayload = {
      error_code: isTokenMissing ? "TOKEN_MISSING" : "TOOL_ERROR",
      account: ACCOUNT,
      remedy: isTokenMissing
        ? `Run: npx @tensakulabs/discord-mcp setup${ACCOUNT !== "default" ? ` --account ${ACCOUNT}` : ""}`
        : "Check daemon status: npx @tensakulabs/discord-mcp status",
      detail,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(errorPayload, null, 2) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
