import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { env } from "./env";
import { parseDatabaseUrl } from "./database-url";

const createPrismaClient = () => {
  const { schema } = parseDatabaseUrl(env.DATABASE_URL);
  const adapter = new PrismaPg(
    { connectionString: env.DATABASE_URL },
    schema ? { schema } : undefined
  );
  return new PrismaClient({ adapter });
};

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDatabaseUrl?: string;
};

const reusablePrisma =
  env.NODE_ENV !== "test" && globalForPrisma.prismaDatabaseUrl === env.DATABASE_URL
    ? globalForPrisma.prisma
    : undefined;

export const prisma = reusablePrisma ?? createPrismaClient();

if (env.NODE_ENV === "development") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDatabaseUrl = env.DATABASE_URL;
}
