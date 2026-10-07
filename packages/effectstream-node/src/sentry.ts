import * as Sentry from "@sentry/bun";

/** Sentry is on only when SENTRY_DSN is set (never locally). release = the git commit the node was built from. */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({ dsn, release: process.env.GIT_COMMIT, environment: process.env.SENTRY_ENVIRONMENT ?? "production" });
}

export function captureError(err: unknown) {
  if (process.env.SENTRY_DSN) Sentry.captureException(err);
}
