export async function rateLimitedFetch(
  input: string,
  init: RequestInit,
  retries = 4
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 1);
    const delay = Math.min(retryAfter * 1000, 8000);
    console.error(`[discord-mcp] Rate limited. Retrying in ${delay}ms...`);
    await new Promise(r => setTimeout(r, delay));
    return rateLimitedFetch(input, init, retries - 1);
  }
  return res;
}

export function makeDiscordHeaders(token: string): Record<string, string> {
  return {
    // ISC-C2: user token — NO "Bot " prefix
    "Authorization": token,
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; discord-mcp/0.1)",
  };
}
