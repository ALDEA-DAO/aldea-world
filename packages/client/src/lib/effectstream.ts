/** The Effectstream node's read API (activity, births, the Atlas) and its real-time events. Public: no session. */
export const effectstreamUrl = import.meta.env.VITE_EFFECTSTREAM_API_URL ?? "http://localhost:9999";
export const effectstreamMqttUrl = import.meta.env.VITE_EFFECTSTREAM_MQTT_URL ?? "ws://localhost:9883";

export class EffectstreamError extends Error {
  constructor(
    path: string,
    readonly status: number,
  ) {
    super(`Effectstream ${path}: ${status}`);
  }
}

export async function effectstreamApi<T>(path: string): Promise<T> {
  const res = await fetch(`${effectstreamUrl}${path}`);
  if (!res.ok) throw new EffectstreamError(path, res.status);
  return (await res.json()) as T;
}

/**
 * Effectstream publishes an event as `app/<event>/blockHeight/<n>/<indexed field>/<value>`. The Atlas' is the only
 * one indexed by `worldId`, so this filter is "any world of the Atlas changed".
 */
const ATLAS_WORLDS_TOPIC = "app/+/blockHeight/+/worldId/+";

/**
 * Calls `onChange` with the id of every world the Atlas registers or updates, as it happens. MQTT loads on first use
 * and reconnects by itself; the returned function stops listening.
 */
export function subscribeAtlasWorlds(onChange: (worldId: string) => void): () => void {
  let stopped = false;
  let end: (() => void) | undefined;
  void import("mqtt").then(({ default: mqtt }) => {
    if (stopped) return;
    const client = mqtt.connect(effectstreamMqttUrl, { reconnectPeriod: 5_000 });
    client.on("connect", () => client.subscribe(ATLAS_WORLDS_TOPIC));
    client.on("message", (topic) => {
      const worldId = topic.split("/").at(-1);
      if (worldId) onChange(worldId.toLowerCase());
    });
    // The read API still answers without the broker: connection errors only mean no live updates for now
    client.on("error", () => undefined);
    end = () => client.end(true);
  });
  return () => {
    stopped = true;
    end?.();
  };
}
