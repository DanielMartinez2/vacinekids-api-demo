import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import { HttpError } from "../../lib/http-error";
import type {
  CreateDependentInput,
  DependentListQuery,
  ProfileInput,
  UpdateDependentInput
} from "./customer.schemas";

const profileSelect = {
  id: true,
  name: true,
  phone: true,
  createdAt: true,
  updatedAt: true
} as const;

const dependentSelect = {
  id: true,
  name: true,
  birthDate: true,
  createdAt: true,
  updatedAt: true
} as const;

const serializeDependent = <T extends {
  id: string;
  name: string;
  birthDate: Date;
  createdAt: Date;
  updatedAt: Date;
}>(dependent: T) => ({
  ...dependent,
  birthDate: dependent.birthDate.toISOString().slice(0, 10)
});

const pagination = (page: number, pageSize: number, total: number) => ({
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize)
});

const dependentNotFound = () =>
  new HttpError(404, "DEPENDENT_NOT_FOUND", "Dependent not found");

export const createCustomerService = (db: PrismaClient, schema = "public") => ({
  async getProfile(userId: string) {
    return db.customerProfile.findUnique({ where: { userId }, select: profileSelect });
  },

  async upsertProfile(userId: string, input: ProfileInput) {
    return db.$transaction(async (tx) => {
      // Serialize the first profile creation with local ADMIN promotion.
      const usersTable = Prisma.raw(`"${schema.replaceAll('"', '""')}"."users"`);
      await tx.$queryRaw(Prisma.sql`SELECT id FROM ${usersTable} WHERE id = ${userId}::uuid FOR UPDATE`);
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
      if (!user || user.status !== "ACTIVE") {
        throw new HttpError(401, "UNAUTHENTICATED", "Autenticação necessária.");
      }
      if (user.role !== "CUSTOMER") {
        throw new HttpError(403, "FORBIDDEN", "Permissão insuficiente.");
      }
      return tx.customerProfile.upsert({
        where: { userId },
        create: { userId, ...input },
        update: input,
        select: profileSelect
      });
    });
  },

  async listDependents(userId: string, query: DependentListQuery) {
    const where = { deletedAt: null, customerProfile: { userId } };
    const [items, total] = await db.$transaction([
      db.dependent.findMany({
        where,
        select: dependentSelect,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize
      }),
      db.dependent.count({ where })
    ]);
    return {
      items: items.map(serializeDependent),
      meta: pagination(query.page, query.pageSize, total)
    };
  },

  async createDependent(userId: string, input: CreateDependentInput) {
    const profile = await db.customerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) {
      throw new HttpError(409, "PROFILE_REQUIRED", "Complete o perfil antes de adicionar dependentes.");
    }
    const dependent = await db.dependent.create({
      data: { customerProfileId: profile.id, ...input },
      select: dependentSelect
    });
    return serializeDependent(dependent);
  },

  async getDependent(userId: string, id: string) {
    const dependent = await db.dependent.findFirst({
      where: { id, deletedAt: null, customerProfile: { userId } },
      select: dependentSelect
    });
    if (!dependent) throw dependentNotFound();
    return serializeDependent(dependent);
  },

  async updateDependent(userId: string, id: string, input: UpdateDependentInput) {
    const dependents = await db.dependent.updateManyAndReturn({
      where: { id, deletedAt: null, customerProfile: { userId } },
      data: input,
      select: dependentSelect
    });
    const dependent = dependents[0];
    if (!dependent) throw dependentNotFound();
    return serializeDependent(dependent);
  },

  async deleteDependent(userId: string, id: string) {
    const result = await db.dependent.updateMany({
      where: { id, deletedAt: null, customerProfile: { userId } },
      data: { deletedAt: new Date() }
    });
    if (result.count === 0) throw dependentNotFound();
  }
});

export type CustomerService = ReturnType<typeof createCustomerService>;
