/** The Effectstream node's read API (activity, births, the Atlas later). Public: no session. */
export const effectstreamUrl = import.meta.env.VITE_EFFECTSTREAM_API_URL ?? "http://localhost:9999";

export async function effectstreamApi<T>(path: string): Promise<T> {
  const res = await fetch(`${effectstreamUrl}${path}`);
  if (!res.ok) throw new Error(`Effectstream ${path}: ${res.status}`);
  return (await res.json()) as T;
}
