import { Prisma, type PrismaClient } from "../generated/prisma/client";
import { HttpError } from "../src/lib/http-error";
import { emailSchema } from "../src/modules/auth/auth.schemas";
import { publicUserSelect } from "../src/modules/auth/auth.service";

const promotionSelect = {
  ...publicUserSelect,
  customerProfile: { select: { id: true } }
} as const;

type PromotionCandidate = {
  id: string;
  email: string;
  role: "CUSTOMER" | "ADMIN";
  status: "ACTIVE" | "DISABLED";
  customerProfile: { id: string } | null;
};

const validateCandidate = (user: PromotionCandidate | null) => {
  if (!user || user.status !== "ACTIVE" || user.role !== "CUSTOMER") {
    throw new HttpError(409, "INVALID_PROMOTION", "Somente um CUSTOMER ACTIVE existente pode ser promovido.");
  }
  if (user.customerProfile) {
    throw new HttpError(409, "CUSTOMER_PROFILE_EXISTS", "Conta com perfil de cliente não pode ser promovida.");
  }
  const { customerProfile: _customerProfile, ...publicUser } = user;
  return publicUser;
};

export const promoteAdmin = async (
  db: PrismaClient,
  email: string,
  confirmation?: string,
  schema = "public"
) => {
  const normalizedEmail = emailSchema.parse(email);
  const preview = await db.user.findUnique({ where: { email: normalizedEmail }, select: promotionSelect });
  const user = validateCandidate(preview);
  if (confirmation === undefined) return { user, dryRun: true, revokedSessions: 0 };
  if (confirmation !== `PROMOTE ${user.id}`) throw new HttpError(422, "INVALID_CONFIRMATION", "Confirmação inválida.");
  return db.$transaction(async tx => {
    const usersTable = Prisma.raw(`"${schema.replaceAll('"', '""')}"."users"`);
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ${usersTable} WHERE id = ${user.id}::uuid FOR UPDATE`);
    const lockedCandidate = await tx.user.findUnique({ where: { id: user.id }, select: promotionSelect });
    const lockedUser = validateCandidate(lockedCandidate);
    const changed = await tx.user.updateMany({ where: { id: user.id, role: "CUSTOMER", status: "ACTIVE" }, data: { role: "ADMIN" } });
    if (changed.count !== 1) throw new HttpError(409, "INVALID_PROMOTION", "Estado do usuário mudou. Execute novamente.");
    const revoked = await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { user: { ...lockedUser, role: "ADMIN" as const }, dryRun: false, revokedSessions: revoked.count };
  });
};
