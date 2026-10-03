import { CloudOff, Hammer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnline } from "../../lib/online";
import { useWorldPaused } from "../../mud/store";

/** The village's global states under the top bar: maintenance (the World is paused) and offline. */
export function StatusBanners() {
  const { t } = useTranslation();
  const paused = useWorldPaused();
  const online = useOnline();
  return (
    <div aria-live="polite" className="relative z-20">
      {paused && (
        <p className="flex items-center justify-center gap-2 border-t border-black/20 bg-wood px-4 py-2 text-center text-sm text-on-wood shadow-paper" data-testid="paused-banner">
          <Hammer aria-hidden className="size-4 shrink-0" />
          {t("status.paused")}
        </p>
      )}
      {!online && (
        <p className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm" data-testid="offline-banner">
          <CloudOff aria-hidden className="size-4 shrink-0" />
          {t("status.offline")}
        </p>
      )}
    </div>
  );
}
