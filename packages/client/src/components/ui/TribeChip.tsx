import { tribeByIndex } from "@aldea/shared/catalog";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { TRIBE_ICONS } from "../../features/birth/icons";

/** A tribe as a chip: its color, its biome icon and always its name (never color alone). */
export function TribeChip({ tribe, size = "md" }: { tribe: number; size?: "sm" | "md" }) {
  const { i18n } = useTranslation();
  const info = tribeByIndex(tribe);
  const Icon = TRIBE_ICONS[tribe];
  if (!info || !Icon) return null;
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-full px-3 text-sm font-bold whitespace-nowrap", size === "sm" ? "h-6" : "h-8")}
      style={{ background: `var(${info.colorToken})`, color: "var(--on-tribe)" }}
    >
      <Icon aria-hidden className="size-4" />
      {info.name[i18n.language === "en" ? "en" : "es"]}
    </span>
  );
}
