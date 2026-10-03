import { buildingByRoute, buildings, tribeByIndex } from "@aldea/shared/catalog";
import clsx from "clsx";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { MonoId } from "../../components/ui/MonoId";
import { TribeChip } from "../../components/ui/TribeChip";
import { useCensus } from "../../mud/store";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { RequireSession } from "../auth/RequireSession";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useBirth } from "../birth/useBirth";
import { BuildingContent } from "../buildings/BuildingContent";
import { useBuildingEntry } from "../buildings/useBuildingEntry";

/**
 * List mode (`#/lista`, `#/lista/:buildingSlug`): the village without the canvas. A status header (your soul, your
 * tribe, the census), a `<nav>` with the six buildings and the chosen building's content below, the same components
 * as the panels. Entering a building here is recorded on-chain like in the village. Also where the client lands
 * when the device cannot draw the village.
 */
export function ListMode() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const navigate = useNavigate();
  const { buildingSlug } = useParams();
  const selected = buildingSlug ? buildingByRoute(buildingSlug) : undefined;
  const fallback = Boolean((useLocation().state as { fallback?: boolean } | null)?.fallback);
  const heading = useRef<HTMLHeadingElement>(null);
  const leave = useCallback(() => void navigate("/lista"), [navigate]);
  useBuildingEntry(selected);

  // Entering a building moves the focus to its heading, so a screen reader starts reading inside it
  useEffect(() => {
    if (selected) heading.current?.focus();
  }, [selected]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-3xl">{t("screens.list")}</h1>
      {fallback && (
        <p role="status" className="mt-4 rounded-md bg-surface-raised p-3">
          {t("list.fallback")}
        </p>
      )}
      <StatusHeader />

      <nav aria-label={t("list.buildings")} className="mt-8">
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {buildings.map((b) => (
            <li key={b.slug} className={clsx("flex flex-wrap items-center justify-between gap-3 p-3", selected?.slug === b.slug && "bg-surface-raised")}>
              <div>
                <p className="font-medium">{b.name[lang]}</p>
                <p className="text-sm text-text-muted">{b.underConstruction ? t("list.underConstruction") : t("list.open")}</p>
              </div>
              <Link
                to={`/lista/${b.routeSlug}`}
                aria-current={selected?.slug === b.slug ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-medium text-on-primary bevel"
              >
                {t(`village.enterBuilding.${b.slug}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {buildingSlug && !selected && <p className="mt-8">{t("building.notFound")}</p>}
      {selected && (
        <section aria-labelledby="list-building" className="mt-8 rounded-lg border-2 border-wood bg-surface p-4 md:p-6" data-testid="list-building">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 id="list-building" ref={heading} tabIndex={-1} className="font-display text-2xl outline-none">
              {selected.name[lang]}
            </h2>
            <Link to="/lista" className="underline underline-offset-4">
              {t("list.leave")}
            </Link>
          </div>
          <BuildingContent key={selected.slug} building={selected} onExplore={leave} />
        </section>
      )}
    </div>
  );
}

/** Your soul, your tribe and the census, announced politely when they change (a birth, a new soul). */
function StatusHeader() {
  const { t } = useTranslation();
  const { status, almaId } = useAlmaSession();
  const { character, stage } = useBirth();
  const census = useCensus();
  const tribe = stage === "born" && character ? tribeByIndex(character.tribe) : undefined;
  return (
    <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-md bg-surface-raised p-4" data-testid="list-status">
      {isSignedIn(status) && almaId ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{t("list.yourSoul")}</span>
          <MonoId value={almaId} short />
        </div>
      ) : (
        <RequireSession action={t("list.signInAction")}>
          <span />
        </RequireSession>
      )}
      {tribe && character ? (
        <TribeChip tribe={character.tribe} />
      ) : (
        isSignedIn(status) &&
        stage === "idle" && (
          <Link to="/lista/centro-urbano" className="underline underline-offset-4">
            {t("village.beBorn")}
          </Link>
        )
      )}
      {census && <span data-testid="list-census">{t("census.summary", { born: census.totalPopulation, gestating: census.gestating })}</span>}
    </div>
  );
}
