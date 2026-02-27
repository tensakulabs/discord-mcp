import { exec } from "child_process";
import type { Hook } from "./config.js";

export interface HookContext {
  author: string;
  content: string;
  channel: string;
  guild: string;
  is_dm: boolean;
}

function substitute(template: string, ctx: HookContext): string {
  return template
    .replace(/\{author\}/g, ctx.author)
    .replace(/\{content\}/g, ctx.content.replace(/"/g, '\\"'))
    .replace(/\{channel\}/g, ctx.channel)
    .replace(/\{guild\}/g, ctx.guild)
    .replace(/\{is_dm\}/g, String(ctx.is_dm));
}

async function runHook(hook: Hook, ctx: HookContext): Promise<void> {
  if (!hook.enabled) return;

  if (hook.type === "command" && hook.command) {
    const cmd = substitute(hook.command, ctx);
    exec(cmd, (err) => {
      if (err) console.error(`[discord-mcp hooks] command failed: ${err.message}`);
    });
  }

  if (hook.type === "http" && hook.url) {
    fetch(hook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ctx),
    }).catch((err: Error) => {
      console.error(`[discord-mcp hooks] http failed: ${err.message}`);
    });
  }
}

export async function fireHooks(hooks: Hook[], ctx: HookContext): Promise<void> {
  for (const hook of hooks) {
    runHook(hook, ctx).catch(() => {}); // never block the daemon
  }
}
