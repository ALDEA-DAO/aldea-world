import { FORK_GUIDE_URL } from "@aldea/shared/catalog";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { authConfig } from "../auth/config";
import { aldeaWorldId } from "../../mud/deployment";
import type { AtlasWorld } from "./atlasApi";
import { FilterTabs, type PortalFilter } from "./FilterTabs";
import { travel, TravelDialog } from "./TravelDialog";
import { useAtlas } from "./useAtlas";
import { WorldCard } from "./WorldCard";

/**
 * The Portal of Worlds: the Atlas' public worlds, live. `layout` "panel" is the building's list; "page" is the
 * `#/portal` grid. Verified worlds are what a visitor sees first; unverified ones are a tab away and carry a warning
 * before traveling.
 */
export function Portal({ layout }: { layout: "panel" | "page" }) {
  const { t, i18n } = useTranslation();
  const atlas = useAtlas();
  const [filter, setFilter] = useState<PortalFilter>("verified");
  const [travelTo, setTravelTo] = useState<{ world: AtlasWorld; url: string }>();
  const { home, ownPresenceUrl } = useMemo(() => {
    const config = authConfig();
    return { home: aldeaWorldId(config.chain.id)?.toLowerCase(), ownPresenceUrl: `${config.apiUrl}/v1/presence/aldea` };
  }, []);

  const worlds = atlas.worlds;
  const names = useMemo(() => new Map(worlds?.map((world) => [world.worldId, world.name])), [worlds]);
  const shown = useMemo(
    () => worlds?.filter((world) => (filter === "verified" ? world.verified : filter === "forks" ? home !== undefined && world.parentWorldId === home : true)),
    [worlds, filter, home],
  );

  const onTravel = (world: AtlasWorld, url: string) => (world.verified ? travel(world, url) : setTravelTo({ world, url }));

  if (atlas.status === "failed") {
    return (
      <p className="flex flex-wrap items-center gap-2" data-testid="portal" role="status">
        {t("portal.clouded")}
        <Button variant="ghost" size="sm" className="relative" onClick={atlas.retry}>
          {t("portal.retry")}
        </Button>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="portal">
      {atlas.status === "stale" && atlas.updatedAt && (
        <p className="text-sm text-text-muted" role="status">
          {t("portal.updating", { time: atlas.updatedAt.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }) })}
        </p>
      )}
      <FilterTabs value={filter} onChange={setFilter}>
        {!shown ? (
          <ul className={clsx("mt-4 grid gap-4", layout === "page" && "sm:grid-cols-2 lg:grid-cols-3")} aria-busy>
            {[0, 1].map((i) => (
              <li key={i}>
                <Skeleton variant="block" className="h-40" />
              </li>
            ))}
          </ul>
        ) : shown.length === 0 ? (
          <p className="mt-4 text-sm">{t(`portal.empty.${filter}`)}</p>
        ) : (
          <ul className={clsx("mt-4 grid gap-4", layout === "page" && "sm:grid-cols-2 lg:grid-cols-3")}>
            {shown.map((world) => (
              <li key={world.worldId}>
                <WorldCard
                  world={world}
                  parentName={world.parentWorldId ? names.get(world.parentWorldId) : undefined}
                  here={world.worldId === home}
                  ownPresenceUrl={ownPresenceUrl}
                  highlighted={atlas.changed.has(world.worldId)}
                  onTravel={onTravel}
                />
              </li>
            ))}
          </ul>
        )}
      </FilterTabs>
      {worlds && worlds.length <= 1 && (
        <p className="text-sm">
          {t("portal.onlyWorld")}{" "}
          <a href={FORK_GUIDE_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {t("portal.forkGuide")}
          </a>
        </p>
      )}
      <TravelDialog world={travelTo?.world} url={travelTo?.url} onClose={() => setTravelTo(undefined)} />
    </div>
  );
}
