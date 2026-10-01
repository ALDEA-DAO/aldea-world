import { buildingByRoute, buildings } from "@aldea/shared/catalog";
import { useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Placeholder } from "./Placeholder";
import { SoulRegistry } from "../../features/buildings/SoulRegistry";
import { useCensus } from "../../mud/store";
import { PhaserCanvas } from "../../game/PhaserCanvas";
import { TownCenter } from "../../features/buildings/TownCenter";

/** The village: the game canvas with the door action, the census and the first-time call to be born over it. */
export function VillageScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n.language === "en" ? "en" : "es";
  const enter = useCallback((slug: string) => void navigate(`/b/${buildings.find((b) => b.slug === slug)?.routeSlug ?? ""}`), [navigate]);
  return (
    <div className="relative min-h-[70dvh] flex-1">
      <PhaserCanvas onEnterDoor={enter}>
        {(game) => {
          const door = buildings.find((b) => b.slug === game.door);
          return (
            <>
              <div className="pointer-events-none absolute top-3 left-3 rounded-md bg-wood/90 px-3 py-1 text-sm text-on-wood shadow-paper">
                <CensusLine />
              </div>
              {game.failed ? (
                <div role="alert" className="absolute inset-0 grid place-content-center gap-4 bg-wood p-6 text-center text-on-wood">
                  <p className="text-lg">{t("village.failed")}</p>
                  <Link to="/lista" className="mx-auto inline-flex h-12 items-center rounded-md bg-primary px-5 font-medium text-on-primary bevel">
                    {t("village.useList")}
                  </Link>
                </div>
              ) : !game.ready ? (
                <p role="status" className="absolute inset-0 grid place-content-center font-display text-2xl text-on-wood">
                  {t("village.loading")}
                </p>
              ) : (
                <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-4">
                  {door ? (
                    <Link to={`/b/${door.routeSlug}`} data-testid="enter-building" className="pointer-events-auto inline-flex h-12 items-center rounded-md bg-primary px-6 font-medium text-on-primary shadow-paper bevel">
                      {t("village.enter", { building: door.name[lang] })}
                    </Link>
                  ) : (
                    !game.playerTile && (
                      <Link to="/b/centro-urbano" className="pointer-events-auto inline-flex h-12 items-center rounded-md bg-primary px-6 font-medium text-on-primary shadow-paper bevel">
                        {t("village.beBorn")}
                      </Link>
                    )
                  )}
                  <p className="rounded-md bg-black/45 px-3 py-1 text-center text-xs text-white">{t(game.playerTile ? "village.hint" : "village.guestHint")}</p>
                </div>
              )}
            </>
          );
        }}
      </PhaserCanvas>
    </div>
  );
}

/** Live census from the World (until the Town Center panel and the HUD show it). */
function CensusLine() {
  const { t } = useTranslation();
  const census = useCensus();
  if (!census) return null;
  return (
    <p data-testid="census">
      {t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}
    </p>
  );
}

export function BuildingScreen() {
  const { t, i18n } = useTranslation();
  const { buildingSlug = "" } = useParams();
  const building = buildingByRoute(buildingSlug);
  if (!building) return <NotFoundScreen />;
  if (building.kind === "TownCenter") return <TownCenter />;
  if (building.kind === "SoulRegistry") return <SoulRegistry />;
  return <Placeholder title={building.name[i18n.language === "en" ? "en" : "es"]}>{t("screens.building")}</Placeholder>;
}

export function WorldScreen() {
  const { t } = useTranslation();
  const { worldId } = useParams();
  return (
    <Placeholder title={t("screens.world")}>
      <p className="mt-2 font-mono text-xs break-all">{worldId}</p>
    </Placeholder>
  );
}

/** The public view of any soul (your own shows your keys too). */
export function SoulScreen() {
  const { almaId } = useParams();
  return <SoulRegistry almaId={almaId} />;
}

export function SimpleScreen({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return <Placeholder title={t(titleKey)} />;
}

export function NotFoundScreen() {
  const { t } = useTranslation();
  return <Placeholder title={t("screens.notFound")} />;
}
