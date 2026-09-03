import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler } from "./middlewares/error-handler";
import { notFound } from "./middlewares/not-found";
import { catalogRouter } from "./modules/catalog/catalog.routes";
import { healthRouter } from "./routes/health.routes";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_URL
  })
);
app.use(express.json({ limit: "1mb" }));

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
app.use("/api/v1", catalogRouter);

app.use(notFound);
app.use(errorHandler);
