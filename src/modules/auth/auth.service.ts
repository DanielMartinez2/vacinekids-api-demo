import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import { HttpError } from "../../lib/http-error";
import { getDummyHash, hashPassword, verifyPassword } from "./auth.password";
import { hashToken, newSessionToken, validToken } from "./auth.session";
import type { AuthInput } from "./auth.schemas";

export const publicUserSelect = { id: true, email: true, role: true, status: true } as const;
export type PublicUser = { id: string; email: string; role: "CUSTOMER" | "ADMIN"; status: "ACTIVE" | "DISABLED" };
export const unauthenticated = () => new HttpError(401, "UNAUTHENTICATED", "Autenticação necessária.");
const invalidLogin = () => new HttpError(401, "INVALID_CREDENTIALS", "Email ou senha inválidos.");

export const createAuthService = (db: PrismaClient, clock = () => new Date(), schema = "public") => ({
  async register(input: AuthInput) {
    // Do the same expensive operation for new/duplicate accounts, including races.
    const passwordHash = await hashPassword(input.password);
    try {
      await db.user.create({ data: { email: input.email, passwordHash, role: "CUSTOMER", status: "ACTIVE" }, select: { id: true } });
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
    }
  },

  async login(input: AuthInput, oldToken: unknown) {
    const user = await db.user.findUnique({ where: { email: input.email } });
    const matches = await verifyPassword(user?.passwordHash ?? await getDummyHash(), input.password);
    if (!user || !matches || user.status !== "ACTIVE") throw invalidLogin();
    const session = newSessionToken(clock());
    const identity = await db.$transaction(async tx => {
      // Lock against concurrent status/role changes and administrative promotion.
      const usersTable = Prisma.raw(`"${schema.replaceAll('"', '""')}"."users"`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ${usersTable} WHERE id = ${user.id}::uuid FOR UPDATE`);
      const current = await tx.user.findUnique({ where: { id: user.id }, select: publicUserSelect });
      if (!current || current.status !== "ACTIVE") throw invalidLogin();
      if (validToken(oldToken)) {
        await tx.session.updateMany({ where: { tokenHash: hashToken(oldToken), revokedAt: null }, data: { revokedAt: clock() } });
      }
      await tx.session.create({ data: { userId: user.id, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
      return current;
    });
    return { user: identity, token: session.token };
  },

  async authenticate(token: unknown): Promise<PublicUser> {
    if (!validToken(token)) throw unauthenticated();
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: publicUserSelect } } });
    if (!session || session.revokedAt || session.expiresAt <= clock() || session.user.status !== "ACTIVE") throw unauthenticated();
    return session.user;
  },

  async logout(token: unknown) {
    if (!validToken(token)) return;
    await db.session.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: clock() } });
  }
});
export type AuthService = ReturnType<typeof createAuthService>;
