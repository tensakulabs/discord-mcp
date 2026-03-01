import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { execSync } from "child_process";

const SERVICE = "discord-mcp";
const CONFIG_DIR = join(homedir(), ".config", "discord-mcp");

function keychainAccount(account: string): string {
  return account === "default" ? "user-token" : `user-token-${account}`;
}

function tokenFilePath(account: string): string {
  if (account === "default") return join(CONFIG_DIR, "token.enc");
  return join(CONFIG_DIR, account, "token.enc");
}

function keyFilePath(account: string): string {
  if (account === "default") return join(CONFIG_DIR, "key.bin");
  return join(CONFIG_DIR, account, "key.bin");
}

// macOS: use built-in `security` CLI — no native module compilation required
function saveMacOSKeychain(token: string, account: string): void {
  const acct = keychainAccount(account);
  // Delete existing entry first to avoid "already exists" error
  try { execSync(`security delete-generic-password -s "${SERVICE}" -a "${acct}" 2>/dev/null`); } catch { /* not found, ok */ }
  execSync(`security add-generic-password -s "${SERVICE}" -a "${acct}" -w "${token}"`);
}

function getMacOSKeychain(account: string): string | null {
  const acct = keychainAccount(account);
  try {
    return execSync(`security find-generic-password -s "${SERVICE}" -a "${acct}" -w 2>/dev/null`).toString().trim() || null;
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

export async function saveToken(token: string, account = "default"): Promise<void> {
  // macOS: security CLI always works — no native module needed
  if (platform() === "darwin") {
    saveMacOSKeychain(token, account);
    return;
  }

  // Other platforms: try keytar
  const keytar = await getKeytar();
  const acct = keychainAccount(account);
  try {
    if (!keytar) throw new Error("keytar not available");
    await keytar.setPassword(SERVICE, acct, token);
    return;
  } catch { /* fall through */ }

  // Fallback: encrypt to file (for headless/CI environments)
  console.warn("⚠️  Keychain unavailable, using encrypted file fallback.");
  const tokenFile = tokenFilePath(account);
  const keyFile = keyFilePath(account);
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (account !== "default") mkdirSync(join(CONFIG_DIR, account), { recursive: true, mode: 0o700 });
  let key: Buffer;
  if (existsSync(keyFile)) {
    key = readFileSync(keyFile);
  } else {
    key = randomBytes(32);
    writeFileSync(keyFile, key, { mode: 0o600 });
  }
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  writeFileSync(tokenFile, Buffer.concat([iv, enc]), { mode: 0o600 });
}

export async function getToken(account = "default"): Promise<string> {
  // macOS: try security CLI first
  if (platform() === "darwin") {
    const token = getMacOSKeychain(account);
    if (token) return token;
  }

  // Try keytar
  const keytar = await getKeytar();
  const acct = keychainAccount(account);
  const keychainToken = keytar ? await keytar.getPassword(SERVICE, acct).catch(() => null) : null;
  if (keychainToken) return keychainToken;

  // Fallback: encrypted file
  const tokenFile = tokenFilePath(account);
  const keyFile = keyFilePath(account);
  if (!existsSync(tokenFile) || !existsSync(keyFile)) {
    const flag = account === "default" ? "" : ` --account ${account}`;
    throw new Error(`No Discord token found. Run: npx @tensakulabs/discord-mcp setup${flag}`);
  }
  const key = readFileSync(keyFile);
  const raw = readFileSync(tokenFile);
  const iv = raw.slice(0, 16);
  const enc = raw.slice(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
