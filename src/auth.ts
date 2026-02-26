import keytar from "keytar";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const SERVICE = "discord-mcp";
const ACCOUNT = "user-token";
const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");
const TOKEN_FILE = join(CONFIG_DIR, "token.enc");
const KEY_FILE = join(CONFIG_DIR, "key.bin");

export async function saveToken(token: string): Promise<void> {
  try {
    await keytar.setPassword(SERVICE, ACCOUNT, token);
  } catch {
    // Fallback: encrypt to file (for headless/CI environments)
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    let key: Buffer;
    if (existsSync(KEY_FILE)) {
      key = readFileSync(KEY_FILE);
    } else {
      key = randomBytes(32);
      writeFileSync(KEY_FILE, key, { mode: 0o600 });
    }
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    writeFileSync(TOKEN_FILE, Buffer.concat([iv, enc]), { mode: 0o600 });
  }
}

export async function getToken(): Promise<string> {
  // Try keychain first
  const keychainToken = await keytar.getPassword(SERVICE, ACCOUNT).catch(() => null);
  if (keychainToken) return keychainToken;

  // Fallback: encrypted file
  if (!existsSync(TOKEN_FILE) || !existsSync(KEY_FILE)) {
    throw new Error("No Discord token found. Run: npx discord-mcp setup");
  }
  const key = readFileSync(KEY_FILE);
  const raw = readFileSync(TOKEN_FILE);
  const iv = raw.slice(0, 16);
  const enc = raw.slice(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
