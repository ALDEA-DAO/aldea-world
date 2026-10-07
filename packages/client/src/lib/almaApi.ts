/**
 * Calls to the ALMA Resolver's API. Errors are RFC 9457 problems (`{ code, title, detail }`), surfaced as `AlmaApiError`
 * so screens can map `code` to copy.
 */
export class AlmaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    /** The problem's other members, when the Resolver adds facts to it (e.g. `balance` and `minimum`). */
    readonly extra: Record<string, string> = {},
  ) {
    super(title);
  }
}

export function createAlmaApi({ apiUrl, accessToken }: { apiUrl: string; accessToken: () => string | undefined }) {
  return async function almaApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const token = accessToken();
    const res = await fetch(`${apiUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as Record<string, string>;
    if (!res.ok) throw new AlmaApiError(res.status, data.code ?? "unknown", data.title ?? res.statusText, data.detail, data);
    return data as T;
  };
}
