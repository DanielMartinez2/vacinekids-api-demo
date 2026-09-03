import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/database";

const server = app.listen(env.PORT, () => {
  console.log(`VacineKids API demo running on http://localhost:${env.PORT}`);
  console.log(`Health check: http://localhost:${env.PORT}/health`);
});

const shutdown = (signal: string) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
