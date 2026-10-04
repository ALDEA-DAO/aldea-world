/**
 * Product events. No provider is wired yet: each event is dispatched on `window` as `aldea:analytics`, where the
 * analytics integration (and the tests) listen. Never put a soul's identifiers in `props`.
 */
export function track(event: string, props: Record<string, string | number | boolean> = {}) {
  window.dispatchEvent(new CustomEvent("aldea:analytics", { detail: { event, props } }));
}
