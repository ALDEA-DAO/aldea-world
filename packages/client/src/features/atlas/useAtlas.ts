import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeAtlasWorlds } from "../../lib/effectstream";
import { fetchWorlds, type AtlasWorld } from "./atlasApi";

const HIGHLIGHT_MS = 600;
const RETRY_MS = 10_000;

export interface Atlas {
  /** Undefined until the first answer. */
  worlds?: AtlasWorld[];
  /** `stale`: Effectstream stopped answering and `worlds` is the last list it gave. */
  status: "loading" | "ready" | "stale" | "failed";
  /** When `worlds` was read. */
  updatedAt?: Date;
  /** Worlds that changed in the last 600 ms. */
  changed: ReadonlySet<string>;
  retry: () => void;
}

/**
 * The Atlas' public worlds, live: read once, then again whenever Effectstream announces a world over MQTT (and every
 * 10 s while it is not answering).
 */
export function useAtlas(): Atlas {
  const [worlds, setWorlds] = useState<AtlasWorld[]>();
  const [status, setStatus] = useState<Atlas["status"]>("loading");
  const [updatedAt, setUpdatedAt] = useState<Date>();
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  const reload = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    let current = true;
    let answered = false;
    let stale = false;
    const read = () =>
      fetchWorlds().then(
        (next) => {
          if (!current) return;
          answered = true;
          stale = false;
          setWorlds(next);
          setUpdatedAt(new Date());
          setStatus("ready");
        },
        () => {
          if (!current) return;
          stale = answered;
          setStatus(answered ? "stale" : "failed");
        },
      );
    reload.current = read;
    void read();

    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = subscribeAtlasWorlds((worldId) => {
      void read().then(() => {
        if (!current) return;
        setChanged((before) => new Set(before).add(worldId));
        const timer = setTimeout(() => {
          timers.delete(timer);
          setChanged((before) => {
            const next = new Set(before);
            next.delete(worldId);
            return next;
          });
        }, HIGHLIGHT_MS);
        timers.add(timer);
      });
    });
    // While Effectstream is not answering, keep asking: the list comes back by itself
    const retrying = setInterval(() => stale && void read(), RETRY_MS);

    return () => {
      current = false;
      unsubscribe();
      clearInterval(retrying);
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const retry = useCallback(() => {
    setStatus((before) => (before === "failed" ? "loading" : before));
    void reload.current();
  }, []);

  return { worlds, status, updatedAt, changed, retry };
}
