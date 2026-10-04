import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { track } from "../../lib/analytics";
import type { AtlasWorld } from "./atlasApi";

/** Opens a world's client in a new tab that cannot reach back into this one. The Portal never asks for a signature. */
export function travel(world: Pick<AtlasWorld, "verified">, url: string) {
  track("world_travel_clicked", { verified: world.verified });
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The warning before traveling to a world nobody verified: it says where the link goes and what not to do there, and
 * "Travel" stays disabled until the box is ticked. Verified worlds never see it (`travel` is called directly).
 */
export function TravelDialog({ world, url, onClose }: { world?: AtlasWorld; url?: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={world !== undefined} onClose={onClose} title={t("portal.travel.warningTitle")}>
      {/* Keyed by world: the confirmation never carries over from one world to the next */}
      {world && url && <Warning key={world.worldId} world={world} url={url} onClose={onClose} />}
    </Dialog>
  );
}

function Warning({ world, url, onClose }: { world: AtlasWorld; url: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [understood, setUnderstood] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p>{t("portal.travel.warning", { world: world.name })}</p>
      <p className="font-mono text-xs break-all">{url}</p>
      <p className="text-sm">{t("portal.travel.advice")}</p>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 size-4" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        {t("portal.travel.understand")}
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t("portal.travel.stay")}
        </Button>
        <Button
          disabled={!understood}
          onClick={() => {
            travel(world, url);
            onClose();
          }}
        >
          {t("portal.travel.go")}
        </Button>
      </div>
    </div>
  );
}
