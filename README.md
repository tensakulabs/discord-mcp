# discord-mcp

Discord selfbot MCP server — read & send Discord messages from Claude Code or OpenClaw.

> ⚠️ **Selfbot Warning:** This uses your Discord user token, which violates Discord's ToS. Your account may be banned. Use at your own risk.

## What it does

Exposes 6 Discord tools via MCP (Model Context Protocol):

| Tool | Description |
|------|-------------|
| `discord_list_guilds` | List all servers you're in |
| `discord_list_channels` | List text channels in a server |
| `discord_get_messages` | Fetch recent messages from a channel |
| `discord_get_dms` | List your open DM conversations |
| `discord_send_message` | Send a message (channel or DM) |
| `discord_get_unread` | Get messages you haven't seen yet |

## Setup

### 1. Install & configure

```bash
npx @tensakulabs/discord-mcp setup
```

This will:
1. Show you how to extract your Discord token from the desktop app
2. Save it securely to your OS keychain
3. Auto-register the MCP server in Claude's config

### 2. Token extraction (step shown during setup)

Open Discord desktop app → Press **Ctrl+Shift+I** (or **Cmd+Option+I** on Mac) → **Network** tab → Send any message in Discord → filter requests by `messages` → click any request → **Headers** tab → find the `Authorization` header → copy its value.

### 3. Restart Claude

Restart Claude desktop app. You'll see Discord tools available.

### Verify it's working

```bash
npx @tensakulabs/discord-mcp status
# ✅ Connected as: yourname#0
```

## Manual MCP config (if auto-config fails)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "discord": {
      "command": "npx",
      "args": ["-y", "@tensakulabs/discord-mcp"]
    }
  }
}
```

## Usage with Claude

Once registered, Claude can use Discord tools directly:

```
"What did I miss in the #general channel of the Tensaku server?"
→ Claude calls discord_list_guilds, discord_list_channels, discord_get_unread

"Reply to Alex saying I'll be there at 5pm"
→ Claude calls discord_send_message with replyToMessageId
```

## OpenClaw integration

Add to OpenClaw's MCP config:

```json
{
  "mcp": {
    "servers": [{
      "name": "discord",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@tensakulabs/discord-mcp"]
    }]
  }
}
```

## Security

- Token stored in OS keychain (macOS Keychain, Linux Secret Service, Windows Credential Store)
- Fallback: AES-256-CBC encrypted file at `~/.config/discord-mcp/token.enc`
- Token never written to config files or logs
- State (last-seen timestamps, channel modes) at `~/.config/discord-mcp/state.json`

## Architecture

```
discord-mcp/
├── src/
│   ├── index.ts          MCP server entry — registers 6 tools
│   ├── cli.ts            setup + status commands
│   ├── auth.ts           keychain token storage
│   ├── ratelimit.ts      429 backoff + Discord headers
│   ├── state.ts          per-channel state (review/auto/muted + last-seen)
│   └── tools/
│       ├── list_guilds.ts
│       ├── list_channels.ts
│       ├── get_messages.ts
│       ├── get_dms.ts
│       ├── send_message.ts
│       └── get_unread.ts
```

All Discord API calls go through `rateLimitedFetch` — automatic backoff on 429.
