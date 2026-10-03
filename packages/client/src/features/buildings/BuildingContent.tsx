import type { BuildingInfo } from "@aldea/shared/catalog";
import { useTranslation } from "react-i18next";
import { Portal } from "../atlas/Portal";
import { Council } from "./Council";
import { SoulRegistryContent } from "./SoulRegistry";
import { TownCenter } from "./TownCenter";
import { UnderConstructionPanel } from "./UnderConstructionPanel";

/** What is inside a building: the same content in the village's panel and in List mode. */
export function BuildingContent({ building, onExplore }: { building: BuildingInfo; onExplore: () => void }) {
  const { t } = useTranslation();
  if (building.kind === "TownCenter") return <TownCenter onExplore={onExplore} />;
  if (building.kind === "SoulRegistry") return <SoulRegistryContent />;
  if (building.kind === "Council") return <Council />;
  if (building.kind === "Portal") return <Portal layout="panel" />;
  if (building.underConstruction) return <UnderConstructionPanel building={building} />;
  return <p>{t("common.comingSoon")}</p>;
}
