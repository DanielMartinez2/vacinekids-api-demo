import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { validateLocalDatabase } from "./integration-environment";
import { promoteAdmin } from "./promote-admin.service";

const main = async () => {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply") || args.length > 1) throw new Error("Use apenas --apply opcional.");
  // Phase 1A deliberately permits ONLY local administration. No remote escape flag.
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "";
  validateLocalDatabase(databaseUrl, "public");
  if (process.env.NODE_ENV === "production") throw new Error("CLI habilitada apenas localmente nesta fase.");
  if (!process.stdin.isTTY) throw new Error("Use um terminal interativo; email e confirmação não são argumentos CLI.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: "public" }) });
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = await terminal.question("Email do usuário (confirme a identidade fora da aplicação): ");
    const preview = await promoteAdmin(db, email);
    console.log({ environment: "local/public", ...preview });
    if (!args.includes("--apply")) return;
    const confirmation = await terminal.question(`Digite PROMOTE ${preview.user.id} para confirmar: `);
    const result = await promoteAdmin(db, email, confirmation);
    console.log({ event: "user_promoted", userId: result.user.id, role: result.user.role,
      revokedSessions: result.revokedSessions, timestamp: new Date().toISOString() });
  } finally { terminal.close(); await db.$disconnect(); }
};

main().catch(() => {
  console.error("Promoção não concluída. Verifique o alvo local, estado do usuário e confirmação. Nenhum detalhe sensível foi registrado.");
  process.exitCode = 1;
});
