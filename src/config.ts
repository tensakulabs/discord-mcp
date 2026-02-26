import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  retention: {
    guild_channels: number;   // days — default 30
    dms: number;              // days — default 90
    mentioned: number;        // days — default 90
    fallback_to_api: boolean; // fetch from Discord REST on SQLite miss — default true
  };
}

const DEFAULTS: Config = {
  retention: {
    guild_channels: 30,
    dms: 90,
    mentioned: 90,
    fallback_to_api: true,
  },
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Partial<Config>;
    return {
      retention: { ...DEFAULTS.retention, ...(raw.retention ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

export function writeDefaultConfig(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2));
  }
}
