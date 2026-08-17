const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const combined = new TextEncoder().encode(saltHex + password);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [saltHex, expectedHex] = storedHash.split(":");
  if (!saltHex || !expectedHex) return false;

  const combined = new TextEncoder().encode(saltHex + password);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  const hashHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex === expectedHex;
}
