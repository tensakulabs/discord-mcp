import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");

function stateFilePath(account: string): string {
  return account === "default"
    ? join(CONFIG_DIR, "state.json")
    : join(CONFIG_DIR, account, "state.json");
}

type ChannelMode = "review" | "auto" | "muted";

interface ChannelState {
  mode: ChannelMode;
  expiresAt?: number;    // unix ms — if set, revert to review after
  lastSeen?: number;     // unix ms — last message timestamp read (for get_unread)
}

type StateMap = Record<string, ChannelState>;

function load(account: string): StateMap {
  const stateFile = stateFilePath(account);
  if (!existsSync(stateFile)) return {};
  try { return JSON.parse(readFileSync(stateFile, "utf8")); }
  catch { return {}; }
}

function save(state: StateMap, account: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (account !== "default") mkdirSync(join(CONFIG_DIR, account), { recursive: true, mode: 0o700 });
  writeFileSync(stateFilePath(account), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function getChannelMode(channelId: string, account = "default"): ChannelMode {
  const state = load(account);
  const s = state[channelId] ?? { mode: "review" };
  // Auto-expire
  if (s.expiresAt && Date.now() > s.expiresAt) {
    state[channelId] = { ...s, mode: "review", expiresAt: undefined };
    save(state, account);
    return "review";
  }
  return s.mode;
}

export function setChannelMode(
  channelId: string,
  mode: ChannelMode,
  durationMs?: number,
  account = "default"
): void {
  const state = load(account);
  state[channelId] = {
    ...(state[channelId] ?? {}),
    mode,
    expiresAt: durationMs ? Date.now() + durationMs : undefined,
  };
  save(state, account);
}

export function markSeen(channelId: string, timestamp: number, account = "default"): void {
  const state = load(account);
  state[channelId] = { ...(state[channelId] ?? { mode: "review" }), lastSeen: timestamp };
  save(state, account);
}

export function getLastSeen(channelId: string, account = "default"): number {
  const state = load(account);
  return state[channelId]?.lastSeen ?? 0;
}
