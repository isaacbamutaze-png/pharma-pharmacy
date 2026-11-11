/**
 * Password hashing (WebCrypto, works offline in browser, Electron and Android).
 *
 * Current format:  pbkdf2$<iterations>$<saltHex>$<hashHex>   (PBKDF2-HMAC-SHA256)
 * Legacy format:   <saltHex>:<hashHex>                        (single SHA-256)
 *
 * Legacy hashes still verify so nobody is locked out; they are upgraded to the
 * current format automatically at the next successful login.
 */

const SALT_LENGTH = 16;
const ITERATIONS = 210_000;
const KEY_BITS = 256;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${hash}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (storedHash.startsWith("pbkdf2$")) {
    const [, iterStr, saltHex, expectedHex] = storedHash.split("$");
    const iterations = Number(iterStr);
    if (!saltHex || !expectedHex || !Number.isFinite(iterations)) return false;
    const actual = await pbkdf2(password, fromHex(saltHex), iterations);
    return safeEqual(actual, expectedHex);
  }

  // Legacy single-round SHA-256.
  const [saltHex, expectedHex] = storedHash.split(":");
  if (!saltHex || !expectedHex) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(saltHex + password),
  );
  return safeEqual(toHex(new Uint8Array(digest)), expectedHex);
}

/** True when the stored hash should be re-hashed with the current settings. */
export function needsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith("pbkdf2$")) return true;
  return Number(storedHash.split("$")[1]) < ITERATIONS;
}
