import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { execSync } from "child_process";

const SERVICE = "discord-mcp";
const ACCOUNT = "user-token";
const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");
const TOKEN_FILE = join(CONFIG_DIR, "token.enc");
const KEY_FILE = join(CONFIG_DIR, "key.bin");

// macOS: use built-in `security` CLI — no native module compilation required
function saveMacOSKeychain(token: string): void {
  // Delete existing entry first to avoid "already exists" error
  try { execSync(`security delete-generic-password -s "${SERVICE}" -a "${ACCOUNT}" 2>/dev/null`); } catch { /* not found, ok */ }
  execSync(`security add-generic-password -s "${SERVICE}" -a "${ACCOUNT}" -w "${token}"`);
}

function getMacOSKeychain(): string | null {
  try {
    return execSync(`security find-generic-password -s "${SERVICE}" -a "${ACCOUNT}" -w 2>/dev/null`).toString().trim() || null;
  } catch {
    return null;
  }
}

type Keytar = { setPassword(s: string, a: string, p: string): Promise<void>; getPassword(s: string, a: string): Promise<string | null> };
let _keytar: Keytar | null = null;
async function getKeytar(): Promise<Keytar | null> {
  if (_keytar !== undefined) return _keytar;
  try { _keytar = (await import("keytar")).default as Keytar; } catch { _keytar = null; }
  return _keytar;
}

export async function saveToken(token: string): Promise<void> {
  // macOS: security CLI always works — no native module needed
  if (platform() === "darwin") {
    saveMacOSKeychain(token);
    return;
  }

  // Other platforms: try keytar
  const keytar = await getKeytar();
  try {
    if (!keytar) throw new Error("keytar not available");
    await keytar.setPassword(SERVICE, ACCOUNT, token);
    return;
  } catch { /* fall through */ }

  // Fallback: encrypt to file (for headless/CI environments)
  console.warn("⚠️  Keychain unavailable, using encrypted file fallback.");
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

export async function getToken(): Promise<string> {
  // macOS: try security CLI first
  if (platform() === "darwin") {
    const token = getMacOSKeychain();
    if (token) return token;
  }

  // Try keytar
  const keytar = await getKeytar();
  const keychainToken = keytar ? await keytar.getPassword(SERVICE, ACCOUNT).catch(() => null) : null;
  if (keychainToken) return keychainToken;

  // Fallback: encrypted file
  if (!existsSync(TOKEN_FILE) || !existsSync(KEY_FILE)) {
    throw new Error("No Discord token found. Run: npx @tensakulabs/discord-mcp setup");
  }
  const key = readFileSync(KEY_FILE);
  const raw = readFileSync(TOKEN_FILE);
  const iv = raw.slice(0, 16);
  const enc = raw.slice(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
