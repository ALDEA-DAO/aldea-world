/**
 * Product events (the funnel from arriving to being born, and what is used after), without personal data:
 *
 * - who: the hash of the soul's identifier once signed in, a random identifier for this visit before that. No
 *   cookies, nothing kept between visits, no person profiles;
 * - what: the event's name and the few properties listed where it is tracked. Never an address, an email, a soul's
 *   identifier or the page's URL (a soul's public page carries its identifier).
 *
 * Events go to PostHog (EU) through its capture endpoint when `VITE_POSTHOG_KEY` is set; without it nothing leaves
 * the browser. Every event is also dispatched on `window` as `aldea:analytics`, where the tests listen.
 */
export type AnalyticsProps = Record<string, string | number | boolean>;

const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const host = ((import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://eu.i.posthog.com").replace(/\/$/, "");
const VISIT_KEY = "aldea:visit";

let soul: string | undefined;

/** A random identifier for this visit: it lives in this tab's session and nowhere else. */
function visit(): string {
  try {
    const known = sessionStorage.getItem(VISIT_KEY);
    if (known) return known;
    const fresh = `visit:${crypto.randomUUID()}`;
    sessionStorage.setItem(VISIT_KEY, fresh);
    return fresh;
  } catch {
    return "visit:unknown";
  }
}

/** Who the next events are about: the soul's `almaIdHash` once signed in, nobody in particular after signing out. */
export function identify(almaIdHash: string | undefined) {
  soul = almaIdHash;
}

export function track(event: string, props: AnalyticsProps = {}) {
  window.dispatchEvent(new CustomEvent("aldea:analytics", { detail: { event, props } }));
  if (!key) return;
  const body = JSON.stringify({
    api_key: key,
    event,
    distinct_id: soul ?? visit(),
    timestamp: new Date().toISOString(),
    properties: { ...props, signed_in: soul !== undefined, $process_person_profile: false, $lib: "aldea-world" },
  });
  // keepalive: an event sent while the page is closing (a travel to another world) still leaves
  void fetch(`${host}/i/v0/e/`, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
}

/** Tracks an event once per page load, whatever mounts and remounts. */
const once = new Set<string>();
export function trackOnce(event: string, props: AnalyticsProps = {}) {
  if (once.has(event)) return;
  once.add(event);
  track(event, props);
}
