import { createHash, randomBytes } from "node:crypto";

export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const validToken = (token: unknown): token is string =>
  typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) &&
  Buffer.from(token, "base64url").toString("base64url") === token;
export const newSessionToken = (now = new Date()) => {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000) };
};
