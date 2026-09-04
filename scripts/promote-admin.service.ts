import type { PrismaClient } from "../generated/prisma/client";
import { HttpError } from "../src/lib/http-error";
import { emailSchema } from "../src/modules/auth/auth.schemas";
import { publicUserSelect } from "../src/modules/auth/auth.service";

export const promoteAdmin = async (db: PrismaClient, email: string, confirmation?: string) => {
  const user = await db.user.findUnique({ where: { email: emailSchema.parse(email) }, select: publicUserSelect });
  if (!user || user.status !== "ACTIVE" || user.role !== "CUSTOMER") {
    throw new HttpError(409, "INVALID_PROMOTION", "Somente um CUSTOMER ACTIVE existente pode ser promovido.");
  }
  if (confirmation === undefined) return { user, dryRun: true, revokedSessions: 0 };
  if (confirmation !== `PROMOTE ${user.id}`) throw new HttpError(422, "INVALID_CONFIRMATION", "Confirmação inválida.");
  return db.$transaction(async tx => {
    const changed = await tx.user.updateMany({ where: { id: user.id, role: "CUSTOMER", status: "ACTIVE" }, data: { role: "ADMIN" } });
    if (changed.count !== 1) throw new HttpError(409, "INVALID_PROMOTION", "Estado do usuário mudou. Execute novamente.");
    const revoked = await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { user: { ...user, role: "ADMIN" as const }, dryRun: false, revokedSessions: revoked.count };
  });
};
