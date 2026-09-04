import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/error-handler";
import { notFound } from "./middlewares/not-found";
import { createCatalogRouter } from "./modules/catalog/catalog.routes";
import { healthRouter } from "./routes/health.routes";
import { prisma } from "./config/database";
import { parseDatabaseUrl } from "./config/database-url";
import { createAuthService, type AuthService } from "./modules/auth/auth.service";
import { createAuthRouter } from "./modules/auth/auth.routes";
import { writeGuard } from "./middlewares/auth-write-guard";

export const createApp = (authService: AuthService = createAuthService(prisma, undefined, parseDatabaseUrl(env.DATABASE_URL).schema ?? "public")) => {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use("/api/v1/auth", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      allowedHeaders: ["Content-Type", "X-VacineKids-CSRF"],
      methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]
    })
  );
  app.use("/api/v1", writeGuard(env.FRONTEND_URL));
  app.use("/api/v1/auth", express.json({ limit: "8kb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/health", healthRouter);
  app.get("/api/v1", (_req, res) => {
    res.status(200).json({
      data: {
        name: "VacineKids API demo",
        version: "v1",
        resources: ["vaccines", "packages", "age-ranges"]
      },
      error: null
    });
  });
  app.use("/api/v1/auth", createAuthRouter(authService, env.NODE_ENV));
  app.use("/api/v1", createCatalogRouter(authService, env.NODE_ENV));

  app.use(notFound);
  app.use(errorHandler);
  return app;
};

export const app = createApp();
