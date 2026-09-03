import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(422).json({
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.issues.map(({ path, message }) => ({ field: path.join("."), message }))
      }
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      data: null,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {})
      }
    });
    return;
  }

  const prismaCode = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (prismaCode === "P2002") {
    res.status(409).json({
      data: null,
      error: {
        code: "CONFLICT",
        message: "A record with the same unique fields already exists"
      }
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    data: null,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error"
    }
  });
};
