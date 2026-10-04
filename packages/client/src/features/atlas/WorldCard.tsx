import clsx from "clsx";
import { BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { fetchPresence, travelUrl, type AtlasWorld, type WorldPresence } from "./atlasApi";

const PRESENCE_REFRESH_MS = 30_000;

export const shortCid = (cid: string) => (cid.length > 16 ? `${cid.slice(0, 8)}…${cid.slice(-4)}` : cid);

export function VerifiedBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-success/15 px-1.5 text-xs font-bold">
      <BadgeCheck aria-hidden className="size-3.5" />
      {t("portal.verified")}
    </span>
  );
}

export interface WorldCardProps {
  world: AtlasWorld;
  /** Name of the world it was forked from, when the Portal knows it. */
  parentName?: string;
  /** This client's own world: no "Travel", and its presence comes from this client's Resolver. */
  here: boolean;
  ownPresenceUrl?: string;
  /** Changed a moment ago: shown with a soft highlight. */
  highlighted: boolean;
  onTravel: (world: AtlasWorld, url: string) => void;
}

/**
 * A world of the Atlas. What the chain says (organization, verification, official version, lineage, activity) and
 * what the world's own client says (presence) are labeled apart.
 */
export function WorldCard({ world, parentName, here, ownPresenceUrl, highlighted, onTravel }: WorldCardProps) {
  const { t } = useTranslation();
  const [presence, setPresence] = useState<WorldPresence>();
  const url = travelUrl(world);

  useEffect(() => {
    let current = true;
    const read = () => void fetchPresence(world, here ? ownPresenceUrl : undefined).then((p) => current && setPresence(p));
    read();
    const timer = setInterval(read, PRESENCE_REFRESH_MS);
    return () => {
      current = false;
      clearInterval(timer);
    };
    // Read again when the world's clients change
  }, [world.worldId, url, here, ownPresenceUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <article
      aria-label={world.name}
      className={clsx(
        "flex h-full flex-col gap-2 rounded-md border bg-surface-raised p-4 transition-[box-shadow,border-color] duration-[600ms]",
        highlighted ? "border-accent shadow-[0_0_0_3px_var(--color-accent)]" : "border-border",
      )}
      data-highlighted={highlighted || undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl">
          <Link to={`/portal/${world.worldId}`} className="underline-offset-4 hover:underline">
            {world.name}
          </Link>
        </h3>
        {world.verified && <VerifiedBadge />}
      </div>
      <p className="font-mono text-xs break-all text-text-muted">{world.org.almaId ?? world.org.almaIdHash}</p>
      {world.parentWorldId && <p className="text-sm">{t("portal.forkOf", { world: parentName ?? t("portal.anotherWorld") })}</p>}
      <p className="text-sm" data-testid="world-version">
        {world.official ? t("portal.officialVersion", { semver: world.official.semver, cid: shortCid(world.official.clientCid) }) : t("portal.noOfficialVersion")}
      </p>
      <p className="text-sm" data-testid="world-activity">
        {world.activity24h ? t("portal.activity24h", { births: world.activity24h.births, visits: world.activity24h.visits }) : t("portal.notMeasurable")}
      </p>
      {presence && (
        <p className="text-sm text-text-muted" data-testid="world-presence">
          {presence.state === "online" ? t("portal.presence.online", { count: presence.online }) : t(`portal.presence.${presence.state}`)}
        </p>
      )}
      <div className="mt-auto pt-2">
        {here ? (
          <p className="text-sm font-medium">{t("portal.youAreHere")}</p>
        ) : url ? (
          <Button variant="secondary" size="sm" className="relative" onClick={() => onTravel(world, url)}>
            {t("portal.travel.button")}
          </Button>
        ) : (
          <p className="text-sm text-text-muted">{t("portal.noClient")}</p>
        )}
      </div>
    </article>
  );
}
