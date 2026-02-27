#!/usr/bin/env node
import { Command } from "commander";
import { createInterface } from "readline";
import { saveToken, getToken } from "./auth.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { homedir, platform } from "os";
import { join, resolve } from "path";

const program = new Command();

program
  .name("discord-mcp")
  .description("Discord selfbot MCP server for Claude")
  .version("0.1.0");

program
  .command("setup")
  .description("Configure Discord token and register MCP server")
  .action(async () => {
    console.log(`
╔══════════════════════════════════════════════════╗
║         discord-mcp setup                       ║
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
    const token = await new Promise<string>(resolve => {
      rl.question("Paste your Discord token: ", ans => { rl.close(); resolve(ans.trim()); });
    });

    if (!token || token.length < 20) {
      console.error("❌ Invalid token. Try again.");
      process.exit(1);
    }

    await saveToken(token);
    console.log("✅ Token saved securely to OS keychain (or encrypted file fallback).");

    // Auto-patch claude_desktop_config.json
    const configPaths = [
      join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),  // macOS
      join(homedir(), ".config", "Claude", "claude_desktop_config.json"),                          // Linux
      join(process.env["APPDATA"] ?? "", "Claude", "claude_desktop_config.json"),                 // Windows
    ];

    const configPath = configPaths.find(existsSync);
    // Write launchd plist (macOS only) — ISC-D6
    if (platform() === "darwin") {
      const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
      const plistPath = join(launchAgentsDir, "com.discord-mcp.daemon.plist");
      const npxPath = (() => { try { return execSync("which npx").toString().trim(); } catch { return "/usr/local/bin/npx"; } })();
      const logDir = join(homedir(), ".config", "discord-mcp");

      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.discord-mcp.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npxPath}</string>
    <string>@tensakulabs/discord-mcp</string>
    <string>daemon-start</string>
  </array>
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
      writeFileSync(plistPath, plist);
      try {
        execSync(`launchctl unload "${plistPath}" 2>/dev/null; launchctl load "${plistPath}"`);
        console.log(`✅ Daemon registered: com.discord-mcp.daemon (starts at login, running now)`);
      } catch {
        console.log(`✅ Plist written: ${plistPath} (run: launchctl load "${plistPath}")`);
      }
    }

    if (configPath) {
      const config = JSON.parse(readFileSync(configPath, "utf8")) as {
        mcpServers?: Record<string, unknown>;
      };
      config.mcpServers ??= {};
      config.mcpServers["discord"] = {
        command: "npx",
        args: ["-y", "@tensakulabs/discord-mcp"],
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`✅ Registered in Claude config: ${configPath}`);
      console.log("\n🎉 Done! Restart Claude to start using Discord tools.");
    } else {
      console.log(`
⚠️  Could not find Claude desktop config automatically.

Add this to your claude_desktop_config.json manually:

  "mcpServers": {
    "discord": {
      "command": "npx",
      "args": ["-y", "@tensakulabs/discord-mcp"]
    }
  }
`);
    }
  });

program
  .command("daemon-start")
  .description("Start the daemon (called by launchd — not intended for direct use)")
  .action(async () => {
    // Dynamically import daemon to start it
    await import("./daemon.js");
  });

program
  .command("status")
  .description("Check if token is set and valid")
  .action(async () => {
    try {
      const token = await getToken();
      // Validate token with a lightweight API call
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: token },
      });
      if (res.ok) {
        const user = await res.json() as { username: string; discriminator: string };
        console.log(`✅ Connected as: ${user.username}#${user.discriminator}`);
      } else {
        console.error(`❌ Token invalid: HTTP ${res.status}`);
        process.exit(1);
      }
    } catch {
      console.error("❌ No token found. Run: npx @tensakulabs/discord-mcp setup");
      process.exit(1);
    }
  });

program.parse();
