import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

/**
 * RFC 9457 problem details: `application/problem+json` with
 * `{ type, title, status, detail, code }`, where `code` is a stable snake_case string. Never includes stack traces.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
}

export class ProblemError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    /** Extra members of the problem, for facts a client shows (never anything sensitive). */
    readonly extra?: Record<string, string | number>,
  ) {
    super(detail ?? title);
  }
}

const PROBLEM_BASE = "https://api.aldea.world/problems/";

export function problemResponse(c: Context, p: Omit<Problem, "type">) {
  const body: Problem = { type: `${PROBLEM_BASE}${p.code}`, ...p };
  return c.body(JSON.stringify(body), p.status as ContentfulStatusCode, { "Content-Type": "application/problem+json" });
}

/** Maps any thrown error to a problem response; unexpected errors become an opaque 500. */
export function toProblem(err: unknown): Omit<Problem, "type"> {
  if (err instanceof ProblemError) return { status: err.status, code: err.code, title: err.title, detail: err.detail, ...err.extra };
  if (err instanceof ZodError) {
    return { status: 400, code: "invalid_request", title: "Invalid request", detail: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
  }
  if (err instanceof HTTPException) return { status: err.status, code: "http_error", title: err.message || "HTTP error" };
  return { status: 500, code: "internal_error", title: "Internal server error" };
}
