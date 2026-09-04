import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { HttpError } from "../../lib/http-error";

export const passwordOptions = {
  type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32
} as const;

// Bound memory use without an unbounded queue of attacker-controlled passwords.
let inFlight = 0;
const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
  if (inFlight >= 2) throw new HttpError(503, "AUTH_BUSY", "Autenticação temporariamente indisponível.");
  inFlight++;
  try { return await operation(); } finally { inFlight--; }
};

export const hashPassword = (password: string) =>
  bounded(() => argon2.hash(password.normalize("NFC"), passwordOptions));
export const verifyPassword = (hash: string, password: string) =>
  bounded(() => argon2.verify(hash, password.normalize("NFC")));

let dummyHash: Promise<string> | undefined;
export const getDummyHash = () => {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url")).catch(error => {
    dummyHash = undefined;
    throw error;
  });
  return dummyHash;
};
