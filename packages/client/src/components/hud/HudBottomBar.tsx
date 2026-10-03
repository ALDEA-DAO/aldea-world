import type { BuildingInfo } from "@aldea/shared/catalog";
import { buildings } from "@aldea/shared/catalog";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MiniCensus } from "../../features/census/MiniCensus";
import type { GameState } from "../../game/bridge";

const action = "inline-flex h-12 items-center rounded-md bg-primary px-5 font-medium whitespace-nowrap text-on-primary bevel";

/**
 * The wooden bottom of the HUD: what the player can do right where they stand ("Entrar a {edificio}" at a door,
 * "Nacer en ALDEA" before having a character) and the census at a glance. When entering is not possible (maintenance,
 * offline, not born yet), the action is shown disabled with the reason.
 */
export function HudBottomBar({ game, open, enterBlockedReason }: { game: GameState; open?: BuildingInfo; enterBlockedReason: (slug: string) => string | undefined }) {
  const { t } = useTranslation();
  const door = buildings.find((b) => b.slug === game.door);
  const enterBlocked = door && enterBlockedReason(door.slug);
  const hasCharacter = Boolean(game.playerTile);

  return (
    <footer aria-label={t("hud.bottomBar")} className="absolute inset-x-0 bottom-0 z-20 flex h-hud-bottom items-center gap-3 bg-wood px-3 text-on-wood shadow-raised sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {door && door.slug !== open?.slug ? (
          enterBlocked ? (
            <>
              <button type="button" disabled aria-describedby="enter-blocked" data-testid="enter-building" className={`${action} cursor-not-allowed opacity-60`}>
                {t(`village.enterBuilding.${door.slug}`)}
              </button>
              <p id="enter-blocked" className="text-sm">
                {t(enterBlocked)}
              </p>
            </>
          ) : (
            <Link to={`/b/${door.routeSlug}`} data-testid="enter-building" className={action}>
              {t(`village.enterBuilding.${door.slug}`)}
            </Link>
          )
        ) : !hasCharacter && game.ready && open?.kind !== "TownCenter" ? (
          <Link to="/b/centro-urbano" data-testid="be-born" className={action}>
            {t("village.beBorn")}
          </Link>
        ) : null}
        {game.ready && !open && !enterBlocked && <p className="hidden truncate text-sm opacity-80 lg:block">{t(hasCharacter ? "village.hint" : "village.guestHint")}</p>}
      </div>
      <MiniCensus />
    </footer>
  );
}
