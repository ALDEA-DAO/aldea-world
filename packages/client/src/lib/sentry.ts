/**
 * Error reports from the client, on only when `VITE_SENTRY_DSN` is set. Sentry loads after the first screen, so it
 * costs the first load nothing; `release` is the build's git commit. Reports carry no soul: no user is ever set, and
 * the page's address is cut at its route's first segment (a soul's public page has its identifier in the URL).
 */
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function startErrorReports() {
  if (!dsn) return;
  const start = () =>
    void import("@sentry/browser").then((Sentry) =>
      Sentry.init({
        dsn,
        release: (import.meta.env.VITE_BUILD_GIT_COMMIT as string | undefined) || undefined,
        environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ?? "production",
        beforeSend(event) {
          if (event.request?.url) event.request.url = withoutIdentifiers(event.request.url);
          delete event.user;
          return event;
        },
      }),
    );
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 5_000 });
  else setTimeout(start, 2_000);
}

/** `https://aldea.world/#/alma/alma:main:human:5f3c…` → `https://aldea.world/#/alma`. */
export const withoutIdentifiers = (url: string) => url.replace(/(#\/[^/?]+)\/.*$/, "$1");
