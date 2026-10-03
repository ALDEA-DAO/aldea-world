import { FORK_GUIDE_URL, PORTAL_SEED_WORLDS, type PortalWorld } from "@aldea/shared/catalog";
import clsx from "clsx";
import { BadgeCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { effectstreamApi } from "../../lib/effectstream";

interface Activity {
  totals: { births: number; visits: number; uniqueSouls: number };
}

/**
 * The Portal of Worlds until the Atlas feeds it (Phase 3): ALDEA World from the catalog, with its last 24 h from
 * Effectstream, and the invitation to found the second world. `layout` "panel" is the building's list; "page" is the
 * `#/portal` grid.
 */
export function Portal({ layout }: { layout: "panel" | "page" }) {
  const { t } = useTranslation();
  const [activity, setActivity] = useState<Activity>();
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const retry = useCallback(() => (setFailed(false), setRound((n) => n + 1)), []);

  useEffect(() => {
    let current = true;
    effectstreamApi<Activity>("/api/v1/activity/buildings?window=24h")
      .then((a) => current && setActivity(a))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [round]);

  return (
    <div className="flex flex-col gap-4" data-testid="portal">
      <ul className={clsx("grid gap-4", layout === "page" && "sm:grid-cols-2 lg:grid-cols-3")}>
        {PORTAL_SEED_WORLDS.map((world) => (
          <li key={world.almaOrgId}>
            <WorldCard world={world} here activity={activity} failed={failed} onRetry={retry} />
          </li>
        ))}
      </ul>
      {PORTAL_SEED_WORLDS.length === 1 && (
        <p className="text-sm">
          {t("portal.onlyWorld")}{" "}
          <a href={FORK_GUIDE_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {t("portal.forkGuide")}
          </a>
        </p>
      )}
    </div>
  );
}

function WorldCard({ world, here, activity, failed, onRetry }: { world: PortalWorld; here: boolean; activity?: Activity; failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <article aria-label={world.name} className="flex flex-col gap-2 rounded-md border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl">{world.name}</h3>
        {world.verified && (
          <span className="inline-flex items-center gap-1 rounded-sm bg-success/15 px-1.5 text-xs font-bold">
            <BadgeCheck aria-hidden className="size-3.5" />
            {t("portal.verified")}
          </span>
        )}
      </div>
      <p className="font-mono text-xs break-all text-text-muted">{world.almaOrgId}</p>
      {world.forkOf && <p className="text-sm">{t("portal.forkOf", { world: world.forkOf })}</p>}
      <div className="text-sm" data-testid="world-activity">
        {failed ? (
          <span className="flex flex-wrap items-center gap-2">
            {t("portal.clouded")}
            <Button variant="ghost" size="sm" onClick={onRetry}>
              {t("portal.retry")}
            </Button>
          </span>
        ) : activity ? (
          t("portal.activity24h", { births: activity.totals.births, visits: activity.totals.visits })
        ) : (
          <Skeleton className="h-5 w-40" />
        )}
      </div>
      {here && <p className="text-sm font-medium">{t("portal.youAreHere")}</p>}
    </article>
  );
}
