import { Stamp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { TribeChip } from "../ui/TribeChip";

/**
 * The player's soul in the HUD: the tribe (once born), the Founder seal if it has it, and the short identifier, linking
 * to the Soul Registry.
 */
export function SoulChip({ almaId, tribe, founder }: { almaId: string; tribe?: number; founder?: boolean }) {
  const { t } = useTranslation();
  return (
    <Link to="/b/registro-de-almas" title={almaId} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-black/20">
      {tribe !== undefined && <TribeChip tribe={tribe} size="sm" />}
      {founder && (
        <span data-testid="hud-founder" title={t("founder.badge")} className="inline-flex size-5 items-center justify-center rounded-sm bg-accent text-on-accent">
          <Stamp aria-hidden className="size-3.5" />
          <span className="sr-only">{t("founder.badge")}</span>
        </span>
      )}
      <span className="hidden font-mono text-xs opacity-80 sm:inline">{`${almaId.slice(16, 22)}…${almaId.slice(-4)}`}</span>
    </Link>
  );
}
