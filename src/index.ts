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

const server = new Server(
  { name: "discord-mcp", version: "0.2.0" },
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
        result = await listGuilds(); break;
      case "discord_list_channels":
        result = await listChannels((args as { guildId: string }).guildId); break;
      case "discord_get_messages": {
        const a = args as { channelId: string; limit?: number; since?: string; until?: string };
        result = await getMessages(a.channelId, a.limit, a.since, a.until); break;
      }
      case "discord_get_dms":
        result = await getDMChannels(); break;
      case "discord_send_message":
        result = await sendMessage(args as {
          channelId?: string; userId?: string;
          content: string; replyToMessageId?: string;
        }); break;
      case "discord_get_unread":
        result = await getUnread(
          (args as { channels: Array<{ guildName: string; channelName: string; channelId: string }> }).channels
        ); break;
      case "discord_search": {
        const a = args as { query: string; channelId?: string; since?: string; until?: string; limit?: number };
        result = await searchDiscord(a.query, a.channelId, a.since, a.until, a.limit); break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
