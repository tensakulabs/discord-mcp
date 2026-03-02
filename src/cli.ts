#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "readline";
import { saveToken, getToken } from "./auth.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync } from "fs";
import { execSync } from "child_process";
import { homedir, platform } from "os";
import { join, dirname } from "path";

const program = new Command();

program
  .name("discord-mcp")
  .description("Discord selfbot MCP server for Claude")
  .version("0.1.8");

program
  .command("setup")
  .description("Configure Discord token and register MCP server")
  .option("--account <name>", "Account name (e.g. work, personal)", "default")
  .action(async (opts: { account: string }) => {
    const account = opts.account;
    const accountLabel = account === "default" ? "" : ` [${account}]`;

    console.log(`
╔══════════════════════════════════════════════════╗
║         discord-mcp setup${accountLabel.padEnd(22)}║
╚══════════════════════════════════════════════════╝

Step 1: Extract your Discord token

  1. Open Discord desktop app
  2. Press Ctrl+Shift+I (or Cmd+Option+I on Mac) to open DevTools
  3. Click the "Network" tab
  4. Switch to any server or channel to trigger a request
  5. Click any request to discord.com/api/...
  6. Scroll to "Request Headers" → find the "authorization" header
  7. Copy the value (starts with MT or OD — no quotes needed)

`);

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const token = await new Promise<string>(res => {
      rl.question("Paste your Discord token: ", ans => { rl.close(); res(ans.trim()); });
    });

    if (!token || token.length < 20) {
      console.error("❌ Invalid token. Try again.");
      process.exit(1);
    }

    await saveToken(token, account);
    console.log("✅ Token saved securely to OS keychain (or encrypted file fallback).");

    // MCP key and daemon label — namespaced for non-default accounts
    const mcpKey = account === "default" ? "discord" : `discord-${account}`;
    const daemonLabel = account === "default" ? "com.discord-mcp.daemon" : `com.discord-mcp.daemon.${account}`;
    const accountArgs = account === "default" ? [] : ["--account", account];

    // Write launchd plist (macOS only)
    if (platform() === "darwin") {
      const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
      const plistPath = join(launchAgentsDir, `${daemonLabel}.plist`);
      const npxPath = (() => { try { return execSync("which npx").toString().trim(); } catch { return "/usr/local/bin/npx"; } })();
      const nodeBinDir = (() => { try { return dirname(execSync("which node").toString().trim()); } catch { return "/usr/local/bin"; } })();
      const logDir = account === "default"
        ? join(homedir(), ".config", "discord-mcp")
        : join(homedir(), ".config", "discord-mcp", account);

      const daemonCmdArgs = [npxPath, "@tensakulabs/discord-mcp", "daemon-start", ...accountArgs];
      const plistArgs = daemonCmdArgs.map(a => `    <string>${a}</string>`).join("\n");

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${daemonLabel}</string>
  <key>ProgramArguments</key>
  <array>
${plistArgs}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${nodeBinDir}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daemon.log</string>
</dict>
</plist>`;

      mkdirSync(launchAgentsDir, { recursive: true });
      mkdirSync(logDir, { recursive: true, mode: 0o700 });
      writeFileSync(plistPath, plist);
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`);
        console.log(`✅ Daemon registered: ${daemonLabel} (starts at login, running now)`);
      } catch {
        console.log(`✅ Plist written: ${plistPath} (run: launchctl load "${plistPath}")`);
      }
    }

    // Auto-patch Claude Code settings.json
    const configPath = [join(homedir(), ".claude", "settings.json")].find(existsSync);

    if (configPath) {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      config.mcpServers ??= {};
      config.mcpServers[mcpKey] = {
        command: "npx",
        args: ["-y", "@tensakulabs/discord-mcp", "mcp", ...accountArgs],
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ Registered in Claude config as "${mcpKey}": ${configPath}`);
      console.log("\n🎉 Done! Restart Claude Code to start using Discord tools.");
    } else {
      const extraArgs = accountArgs.length ? `, ${accountArgs.map(a => `"${a}"`).join(", ")}` : "";
      console.log(`
⚠️  Could not find Claude Code config automatically.

Add this to your ~/.claude/settings.json manually:

  "mcpServers": {
    "${mcpKey}": {
      "command": "npx",
      "args": ["-y", "@tensakulabs/discord-mcp", "mcp"${extraArgs}]
    }
  }
`);
    }
  });

program
  .command("mcp")
  .description("Start the MCP server (stdio transport — used by Claude Code)")
  .option("--account <name>", "Account name", "default")
  .action(async (opts: { account: string }) => {
    process.env.DISCORD_MCP_ACCOUNT = opts.account;
    await import("./index.js");
  });

program
  .command("daemon-start")
  .description("Start the daemon (called by launchd — not intended for direct use)")
  .option("--account <name>", "Account name", "default")
  .action(async (opts: { account: string }) => {
    process.env.DISCORD_MCP_ACCOUNT = opts.account;
    await import("./daemon.js");
  });

program
  .command("status")
  .description("Check if token is set and valid")
  .option("--account <name>", "Account name", "default")
  .action(async (opts: { account: string }) => {
    try {
      const token = await getToken(opts.account);
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: token },
      });
      if (res.ok) {
        const user = await res.json() as { username: string; discriminator: string };
        const label = opts.account === "default" ? "" : ` [${opts.account}]`;
        console.log(`✅ Connected as${label}: ${user.username}#${user.discriminator}`);
      } else {
        console.error(`❌ Token invalid: HTTP ${res.status}`);
        process.exit(1);
      }
    } catch {
      const flag = opts.account === "default" ? "" : ` --account ${opts.account}`;
      console.error(`❌ No token found. Run: npx @tensakulabs/discord-mcp setup${flag}`);
      process.exit(1);
    }
  });

program
  .command("migrate-account")
  .description("Migrate the default account to a named account")
  .requiredOption("--to <name>", "New account name (e.g. personal, work)")
  .option("--cleanup", "Delete original default files after migration", false)
  .action(async (opts: { to: string; cleanup: boolean }) => {
    const to = opts.to.trim();
    if (!to || to === "default") {
      console.error("❌ Invalid account name. Choose a name other than 'default'.");
      process.exit(1);
    }

    const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");
    const targetDir = join(CONFIG_DIR, to);

    // ISC-A1: Guard — target must not already exist
    if (existsSync(targetDir)) {
      console.error(`❌ Account '${to}' already exists at ${targetDir}. Aborting.`);
      process.exit(1);
    }

    // ISC-A2: Guard — default token must exist
    let token: string;
    try {
      token = await getToken("default");
    } catch {
      console.error("❌ No token found for default account. Nothing to migrate.");
      process.exit(1);
    }

    console.log(`\nMigrating default → ${to}...\n`);

    // 1. Copy token to new keychain slot
    await saveToken(token, to);
    console.log(`✅ Token copied to keychain slot: user-token-${to}`);

    // 2. Copy data files
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const filesToCopy = ["messages.db", "config.json", "state.json"];
    for (const file of filesToCopy) {
      const src = join(CONFIG_DIR, file);
      const dst = join(targetDir, file);
      if (existsSync(src)) {
        copyFileSync(src, dst);
        console.log(`✅ Copied ${file} → ${to}/${file}`);
      }
    }

    // 3. Update settings.json MCP registration
    const claudeConfigPath = join(homedir(), ".claude", "settings.json");
    if (existsSync(claudeConfigPath)) {
      const config = JSON.parse(readFileSync(claudeConfigPath, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      config.mcpServers ??= {};
      if (config.mcpServers["discord"]) {
        config.mcpServers[`discord-${to}`] = {
          command: "npx",
          args: ["-y", "@tensakulabs/discord-mcp", "mcp", "--account", to],
        };
        delete config.mcpServers["discord"];
        writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2));
        console.log(`✅ Claude config: renamed MCP key "discord" → "discord-${to}"`);
      }
    }

    // 4. Re-register launchd daemon (macOS)
    if (platform() === "darwin") {
      const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
      const oldPlistPath = join(launchAgentsDir, "com.discord-mcp.daemon.plist");
      const newLabel = `com.discord-mcp.daemon.${to}`;
      const newPlistPath = join(launchAgentsDir, `${newLabel}.plist`);

      if (existsSync(oldPlistPath)) {
        try { execSync(`launchctl unload "${oldPlistPath}" 2>/dev/null`); } catch { /* ok */ }

        const npxPath = (() => { try { return execSync("which npx").toString().trim(); } catch { return "/usr/local/bin/npx"; } })();
        const nodeBinDir = (() => { try { return dirname(execSync("which node").toString().trim()); } catch { return "/usr/local/bin"; } })();
        const logDir = join(homedir(), ".config", "discord-mcp", to);

        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${newLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npxPath}</string>
    <string>@tensakulabs/discord-mcp</string>
    <string>daemon-start</string>
    <string>--account</string>
    <string>${to}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${nodeBinDir}:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daemon.log</string>
</dict>
</plist>`;

        writeFileSync(newPlistPath, plist);
        try {
          execSync(`launchctl load "${newPlistPath}"`);
          console.log(`✅ Daemon re-registered: ${newLabel} (running now)`);
        } catch {
          console.log(`✅ Plist written: ${newPlistPath} (run: launchctl load "${newPlistPath}")`);
        }

        if (opts.cleanup) {
          rmSync(oldPlistPath, { force: true });
          console.log(`🗑  Removed old plist: com.discord-mcp.daemon.plist`);
        }
      }
    }

    // 5. Cleanup original default files if requested
    if (opts.cleanup) {
      for (const file of filesToCopy) {
        const src = join(CONFIG_DIR, file);
        if (existsSync(src)) {
          rmSync(src, { force: true });
          console.log(`🗑  Removed original: ${file}`);
        }
      }
      console.log("\n✅ Cleanup complete. Default account data removed.");
    } else {
      console.log("\nℹ️  Original default files preserved. Run with --cleanup to remove them.");
    }

    console.log(`\n🎉 Migration complete! Restart Claude Code to use "discord-${to}" MCP.`);
  });

program
  .command("list-accounts")
  .description("List all configured Discord accounts")
  .action(() => {
    const configPath = join(homedir(), ".claude", "settings.json");
    if (!existsSync(configPath)) { console.log("No Claude config found."); return; }
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      mcpServers?: Record<string, { args?: string[] }>;
    };
    const servers = Object.entries(config.mcpServers ?? {})
      .filter(([k]) => k === "discord" || k.startsWith("discord-"));
    if (servers.length === 0) {
      console.log("No Discord accounts configured. Run: npx @tensakulabs/discord-mcp setup");
      return;
    }
    console.log("Configured Discord accounts:");
    for (const [key, val] of servers) {
      const idx = val.args?.indexOf("--account") ?? -1;
      const name = idx >= 0 && val.args ? (val.args[idx + 1] ?? "default") : "default";
      console.log(`  ${key} → account: ${name}`);
    }
  });

// Default: no subcommand → run MCP server
program.action(async () => {
  await import("./index.js");
});

program.parse();
