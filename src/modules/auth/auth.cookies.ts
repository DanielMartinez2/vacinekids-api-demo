import type { CookieOptions, Request, Response } from "express";
import { SESSION_SECONDS } from "./auth.session";

export const sessionCookie = (environment: string) => ({
  name: environment === "production" ? "__Host-vacinekids_session" : "vacinekids_session",
  options: {
    httpOnly: true, secure: environment === "production", sameSite: "lax", path: "/"
  } satisfies CookieOptions
});

export const readSessionCookie = (req: Request, environment: string): unknown =>
  req.cookies?.[sessionCookie(environment).name];
export const setSessionCookie = (res: Response, token: string, environment: string) => {
  const { name, options } = sessionCookie(environment);
  res.cookie(name, token, { ...options, maxAge: SESSION_SECONDS * 1000 });
};
export const clearSessionCookie = (res: Response, environment: string) => {
  const { name, options } = sessionCookie(environment);
  res.clearCookie(name, options);
};
