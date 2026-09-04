import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/http-error";

const dependencyUnavailable = (value: unknown, depth = 0): boolean => {
  if (depth > 5 || typeof value !== "object" || value === null) return false;
  const error = value as Record<string, unknown>;
  const codes = ["P1001", "P1002", "P1008", "P1017", "P2024", "P2037", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P01", "57P02", "57P03"];
  const kinds = ["ConnectionClosed", "DatabaseNotReachable", "SocketTimeout", "TlsConnectionError"];
  return codes.includes(String(error.code ?? error.originalCode)) || kinds.includes(String(error.kind)) ||
    error.name === "PrismaClientInitializationError" ||
    [error.cause, error.meta, error.driverAdapterError].some(nested => dependencyUnavailable(nested, depth + 1));
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  const failure = (status: number, code: string, message: string) => res.status(status).json({ data: null, error: { code, message } });
  if (error?.type === "entity.parse.failed") { failure(400, "INVALID_JSON", "JSON inválido."); return; }
  if (error?.type === "entity.too.large") { failure(413, "PAYLOAD_TOO_LARGE", "Payload muito grande."); return; }
  if (["encoding.unsupported", "charset.unsupported"].includes(error?.type)) { failure(415, "UNSUPPORTED_MEDIA_TYPE", "Formato não suportado."); return; }
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
  if (dependencyUnavailable(error)) {
    console.error(JSON.stringify({ event: "dependency_unavailable", status: 503 }));
    failure(503, "DEPENDENCY_UNAVAILABLE", "Serviço temporariamente indisponível.");
    return;
  }
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

  // Never serialize the error, request, headers, SQL arguments or connection URL.
  console.error(JSON.stringify({ event: "request_failed", status: 500 }));

  res.status(500).json({
    data: null,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error"
    }
  });
};
