import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");
const STATE_FILE = join(CONFIG_DIR, "state.json");

type ChannelMode = "review" | "auto" | "muted";

interface ChannelState {
  mode: ChannelMode;
  expiresAt?: number;    // unix ms — if set, revert to review after
  lastSeen?: number;     // unix ms — last message timestamp read (for get_unread)
}

type StateMap = Record<string, ChannelState>;

function load(): StateMap {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); }
  catch { return {}; }
}

function save(state: StateMap): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function getChannelMode(channelId: string): ChannelMode {
  const state = load();
  const s = state[channelId] ?? { mode: "review" };
  // Auto-expire
  if (s.expiresAt && Date.now() > s.expiresAt) {
    state[channelId] = { ...s, mode: "review", expiresAt: undefined };
    save(state);
    return "review";
  }
  return s.mode;
}

export function setChannelMode(
  channelId: string,
  mode: ChannelMode,
  durationMs?: number
): void {
  const state = load();
  state[channelId] = {
    ...(state[channelId] ?? {}),
    mode,
    expiresAt: durationMs ? Date.now() + durationMs : undefined,
  };
  save(state);
}

export function markSeen(channelId: string, timestamp: number): void {
  const state = load();
  state[channelId] = { ...(state[channelId] ?? { mode: "review" }), lastSeen: timestamp };
  save(state);
}

export function getLastSeen(channelId: string): number {
  const state = load();
  return state[channelId]?.lastSeen ?? 0;
}
