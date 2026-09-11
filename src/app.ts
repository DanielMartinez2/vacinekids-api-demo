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
import { createCustomerRouter } from "./modules/customer/customer.routes";
import { createCustomerService, type CustomerService } from "./modules/customer/customer.service";
import { createOrderService, type OrderService } from "./modules/orders/orders.service";
import { createOrdersRouter } from "./modules/orders/orders.routes";
import { createPaymentsRouter } from "./modules/payments/payments.routes";
import { createPaymentService, type PaymentService } from "./modules/payments/payments.service";
import { DemoPaymentProvider } from "./modules/payments/providers/demo-payment-provider";
import type { PaymentRateLimitOptions } from "./middlewares/payment-rate-limit";

const databaseSchema = parseDatabaseUrl(env.DATABASE_URL).schema ?? "public";

export const createApp = (
  authService: AuthService = createAuthService(prisma, undefined, databaseSchema),
  customerService: CustomerService = createCustomerService(prisma, databaseSchema),
  orderService: OrderService = createOrderService(prisma, undefined, undefined, databaseSchema),
  paymentService: PaymentService = createPaymentService(
    prisma,
    new DemoPaymentProvider(env.PAYMENT_PROVIDER === "DEMO" && env.PAYMENT_DEMO_ENABLED),
    { dispatchLeaseSeconds: env.PAYMENT_DISPATCH_LEASE_SECONDS, schema: databaseSchema }
  ),
  paymentRateLimitOptions?: PaymentRateLimitOptions
) => {
  const app = express();

  app.disable("x-powered-by");
  app.use(helmet());
  app.use("/api/v1/auth", (_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  app.use(["/api/v1/profile", "/api/v1/dependents", "/api/v1/checkout", "/api/v1/orders"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      allowedHeaders: ["Content-Type", "X-VacineKids-CSRF", "Idempotency-Key"],
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
  );
  app.use("/api/v1", writeGuard(env.FRONTEND_URL));
  app.use("/api/v1/auth", express.json({ limit: "8kb" }));
  app.use(["/api/v1/profile", "/api/v1/dependents"], express.json({ limit: "16kb" }));
  app.use("/api/v1/orders/:orderId/payment-attempts", express.json({ limit: "16kb" }));
  app.use(["/api/v1/checkout", "/api/v1/orders"], express.json({ limit: "32kb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/health", healthRouter);
  app.get("/api/v1", (_req, res) => {
    res.status(200).json({
      data: {
        name: "VacineKids API demo",
        version: "v1",
        resources: ["vaccines", "packages", "age-ranges", "profile", "dependents", "checkout", "orders", "payments"]
      },
      error: null
    });
  });
  app.use("/api/v1/auth", createAuthRouter(authService, env.NODE_ENV));
  app.use("/api/v1", createCustomerRouter(authService, customerService, env.NODE_ENV));
  app.use("/api/v1/orders", createPaymentsRouter(authService, paymentService, env.NODE_ENV, paymentRateLimitOptions));
  app.use("/api/v1", createOrdersRouter(authService, orderService, env.NODE_ENV));
  app.use("/api/v1", createCatalogRouter(authService, env.NODE_ENV));

  app.use(notFound);
  app.use(errorHandler);
  return app;
};

export const app = createApp();
