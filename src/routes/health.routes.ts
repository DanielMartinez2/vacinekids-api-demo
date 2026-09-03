import { Router } from "express";
import { prisma } from "../config/database";
import { env } from "../config/env";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      data: {
        status: "ok",
        process: "running",
        database: "connected",
        service: "vacinekids-api-demo",
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString()
      },
      error: null
    });
  } catch {
    res.status(503).json({
      data: {
        status: "degraded",
        process: "running",
        database: "disconnected",
        service: "vacinekids-api-demo",
        environment: env.NODE_ENV,
        timestamp: new Date().toISOString()
      },
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Database connection is unavailable"
      }
    });
  }
});
