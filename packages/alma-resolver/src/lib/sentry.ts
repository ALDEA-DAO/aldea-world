import * as Sentry from "@sentry/node";

/** Sentry is enabled only when SENTRY_DSN is set (never locally). release = git commit. */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({ dsn, release: process.env.GIT_COMMIT, environment: process.env.SENTRY_ENVIRONMENT ?? "production", tracesSampleRate: 0.1 });
  return true;
}

export function captureError(err: unknown) {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}
