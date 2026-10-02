import { buildingByRoute } from "@aldea/shared/catalog";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Panel } from "../../components/ui/Panel";
import { SoulRegistryContent } from "./SoulRegistry";
import { TownCenter } from "./TownCenter";
import { useBuildingEntry } from "./useBuildingEntry";

/**
 * A building's interior, over the village: a side panel on desktop and a bottom sheet on mobile. It opens at once;
 * the entry is recorded on-chain in the background (useBuildingEntry) and closing it records the exit.
 */
export function BuildingPanel() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { buildingSlug = "" } = useParams();
  const building = buildingByRoute(buildingSlug);
  const close = useCallback(() => void navigate("/"), [navigate]);
  useBuildingEntry(building);

  if (!building) {
    return (
      <Panel title={t("building.notFound")} onClose={close} className="z-30">
        <Link to="/" className="text-primary underline underline-offset-4">
          {t("building.backToVillage")}
        </Link>
      </Panel>
    );
  }
  return (
    <Panel key={building.slug} title={building.name[i18n.language === "en" ? "en" : "es"]} onClose={close} className="z-30">
      <div data-testid="building-panel" data-building={building.slug}>
        {building.kind === "TownCenter" ? <TownCenter onExplore={close} /> : building.kind === "SoulRegistry" ? <SoulRegistryContent /> : <p>{t("common.comingSoon")}</p>}
      </div>
    </Panel>
  );
}
