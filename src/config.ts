import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");

function configFilePath(account: string): string {
  return account === "default"
    ? join(CONFIG_DIR, "config.json")
    : join(CONFIG_DIR, account, "config.json");
}

export interface Hook {
  type: "command" | "http";
  enabled: boolean;
  command?: string;  // shell command with {author}, {content}, {channel}, {guild} vars
  url?: string;      // HTTP POST endpoint (receives JSON body)
}

export interface Config {
  retention: {
    guild_channels: number;   // days — default 30
    dms: number;              // days — default 90
    mentioned: number;        // days — default 90
    fallback_to_api: boolean; // fetch from Discord REST on SQLite miss — default true
  };
  hooks: {
    on_mention: Hook[];   // fires on direct @username mention
    on_everyone: Hook[];  // fires on @everyone mention
    on_here: Hook[];      // fires on @here mention
    on_message: Hook[];   // fires on every non-bot message (use sparingly)
  };
}

const DEFAULTS: Config = {
  retention: {
    guild_channels: 30,
    dms: 90,
    mentioned: 90,
    fallback_to_api: true,
  },
  hooks: {
    on_mention: [],
    on_everyone: [],
    on_here: [],
    on_message: [],
  },
};

export function loadConfig(account = "default"): Config {
  const configFile = configFilePath(account);
  if (!existsSync(configFile)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(configFile, "utf8")) as Partial<Config>;
    return {
      retention: { ...DEFAULTS.retention, ...(raw.retention ?? {}) },
      hooks: {
        on_mention: raw.hooks?.on_mention ?? [],
        on_everyone: raw.hooks?.on_everyone ?? [],
        on_here: raw.hooks?.on_here ?? [],
        on_message: raw.hooks?.on_message ?? [],
      },
    };
  } catch {
    return DEFAULTS;
  }
}

export function writeDefaultConfig(account = "default"): void {
  const configFile = configFilePath(account);
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (account !== "default") mkdirSync(join(CONFIG_DIR, account), { recursive: true, mode: 0o700 });
  if (!existsSync(configFile)) {
    writeFileSync(configFile, JSON.stringify(DEFAULTS, null, 2));
  }
}
