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
 * Effectstream publishes an event as `app/<event>/blockHeight/<n>/<indexed field>/<value>`. Each kind of event here
 * is the only one indexed by its field, so the field alone tells them apart.
 */
const ATLAS_WORLDS_TOPIC = "app/+/blockHeight/+/worldId/+";
const COUNCIL_TOPIC = "app/+/blockHeight/+/proposalId/+";

/**
 * Calls `onChange` with the last segment of every message on `topic` (the indexed value), as it happens. MQTT loads on
 * first use and reconnects by itself; the returned function stops listening.
 */
function subscribe(topic: string, onChange: (value: string) => void): () => void {
  let stopped = false;
  let end: (() => void) | undefined;
  void import("mqtt").then(({ default: mqtt }) => {
    if (stopped) return;
    const client = mqtt.connect(effectstreamMqttUrl, { reconnectPeriod: 5_000 });
    client.on("connect", () => client.subscribe(topic));
    client.on("message", (messageTopic) => {
      const value = messageTopic.split("/").at(-1);
      if (value) onChange(value.toLowerCase());
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

/** Calls `onChange` with the id of every world the Atlas registers or updates. */
export const subscribeAtlasWorlds = (onChange: (worldId: string) => void) => subscribe(ATLAS_WORLDS_TOPIC, onChange);

/** Calls `onChange` with the id of every Council proposal that changes: opened, voted on, closed, queued, executed or vetoed. */
export const subscribeCouncil = (onChange: (proposalId: string) => void) => subscribe(COUNCIL_TOPIC, onChange);
