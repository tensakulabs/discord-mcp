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

A background daemon maintains a persistent WebSocket to the Discord Gateway, ingesting messages into a local SQLite database so `discord_get_unread` works even while Claude isn't running.

## Setup

### 1. Install & configure

```bash
npx @tensakulabs/discord-mcp setup
```

This will:
1. Show you how to extract your Discord token from the desktop app
2. Save it securely to your OS keychain (macOS: uses built-in `security` CLI — no native module required)
3. Start the background daemon via launchd (macOS) or systemd (Linux)
4. Auto-register the MCP server in Claude's config

### 2. Token extraction (step shown during setup)

Open Discord desktop app → Press **Ctrl+Shift+I** (or **Cmd+Option+I** on Mac) → **Network** tab → Send any message in Discord → filter requests by `messages` → click any request → **Headers** tab → find the `Authorization` header → copy its value.

### 3. Restart Claude

Restart Claude Code. You'll see Discord tools available.

### Verify it's working

```bash
npx @tensakulabs/discord-mcp status
# ✅ Connected as: yourname#0
```

## Manual MCP config (if auto-config fails)

Add to `~/.claude/settings.json`:

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

## Hooks

Fire shell commands or HTTP webhooks when Discord events occur. Configure in `~/.config/discord-mcp/config.json`:

```json
{
  "hooks": {
    "on_mention": [
      {
        "type": "command",
        "enabled": true,
        "command": "osascript -e 'display notification \"{content}\" with title \"Mention from {author}\"'"
      }
    ],
    "on_everyone": [],
    "on_here": [],
    "on_message": []
  }
}
```

### Hook types

| Hook | Fires when |
|------|-----------|
| `on_mention` | Someone directly @username mentions you |
| `on_everyone` | Someone uses @everyone in a server you're in |
| `on_here` | Someone uses @here in a server you're in |
| `on_message` | Any non-bot message (use sparingly — fires a lot) |

### Hook config fields

| Field | Values | Description |
|-------|--------|-------------|
| `type` | `"command"` \| `"http"` | Shell command or HTTP POST |
| `enabled` | `true` \| `false` | Toggle without removing |
| `command` | string | Shell command (type: command) |
| `url` | string | Endpoint to POST to (type: http) |

### Template variables

Available in `command` strings and HTTP POST body:

| Variable | Value |
|----------|-------|
| `{author}` | Username of message sender |
| `{content}` | Message text |
| `{channel}` | Channel ID |
| `{guild}` | Guild/server ID (or `"dm"` for DMs) |
| `{is_dm}` | `true` or `false` |

### HTTP hook payload

```json
{
  "author": "username",
  "content": "message text",
  "channel": "channel-id",
  "guild": "guild-id",
  "is_dm": false
}
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

- Token stored in OS keychain (macOS: `security` CLI — no native module compilation needed; Linux: keytar; fallback: AES-256-CBC encrypted file)
- Token never written to config files or logs
- Local files at `~/.config/discord-mcp/`: `messages.db`, `config.json`, `token.enc` (fallback only), `daemon.log`

## Architecture

```
discord-mcp/
├── src/
│   ├── index.ts          MCP server entry — registers 6 tools
│   ├── cli.ts            setup + status commands
│   ├── daemon.ts         Discord Gateway WebSocket → SQLite ingestion + hooks
│   ├── auth.ts           keychain token storage (macOS security CLI / keytar / encrypted file)
│   ├── hooks.ts          hook runner — shell commands and HTTP webhooks
│   ├── config.ts         config loader (~/.config/discord-mcp/config.json)
│   ├── db.ts             SQLite schema + queries
│   ├── ratelimit.ts      429 backoff + Discord headers
│   ├── state.ts          per-channel last-seen state
│   ├── purge.ts          scheduled message retention cleanup
│   └── tools/
│       ├── list_guilds.ts
│       ├── list_channels.ts
│       ├── get_messages.ts
│       ├── get_dms.ts
│       ├── send_message.ts
│       └── get_unread.ts
```

All Discord API calls go through `rateLimitedFetch` — automatic backoff on 429.

The daemon runs as a launchd service (`com.discord-mcp.daemon`) on macOS, connecting to `wss://gateway.discord.gg` and storing all messages locally for fast unread queries.
