import { buildingByRoute, buildings } from "@aldea/shared/catalog";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Outlet, useMatch, useNavigate } from "react-router-dom";
import { HudBottomBar } from "../components/hud/HudBottomBar";
import { PhaserCanvas } from "../game/PhaserCanvas";

/**
 * The world on screen: the village canvas with the bottom HUD, kept alive at `#/` and `#/b/*` so building panels
 * (the route's outlet) open over the same village the player is standing in.
 */
export function WorldShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const match = useMatch("/b/:buildingSlug");
  const open = match?.params.buildingSlug ? buildingByRoute(match.params.buildingSlug) : undefined;
  const enter = useCallback((slug: string) => void navigate(`/b/${buildings.find((b) => b.slug === slug)?.routeSlug ?? ""}`), [navigate]);

  return (
    <div className="relative min-h-[70dvh] flex-1">
      <PhaserCanvas onEnterDoor={enter}>
        {(game) => (
          <>
            {game.failed ? (
              // No WebGL, or the village failed to load: the same buildings and actions in List mode
              <Navigate to={open ? `/lista/${open.routeSlug}` : "/lista"} replace state={{ fallback: true }} />
            ) : (
              !game.ready && (
                <p role="status" className="absolute inset-x-0 top-0 bottom-hud-bottom grid place-content-center font-display text-2xl text-on-wood">
                  {t("village.loading")}
                </p>
              )
            )}
            <HudBottomBar game={game} open={open} />
          </>
        )}
      </PhaserCanvas>
      <Outlet />
    </div>
  );
}
