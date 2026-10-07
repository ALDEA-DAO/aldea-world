import { classByIndex, tribeByIndex } from "@aldea/shared/catalog";
import { Stamp } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { assetUrl, manifest } from "../../game/assets/manifest";
import { worldConfig } from "../../theme/worldConfig";
import { TRIBE_ICONS } from "../birth/icons";
import { useShareSoulCard } from "./useShareSoulCard";

export interface SoulCardProps {
  almaId: string;
  characterClass: number;
  tribe: number;
  founder: boolean;
}

/** The row of a character sheet that faces whoever looks at the map. */
const FACING_ROW = 1;
/** `alma:main:human:5f3c…a310` → `5f3c…a310`: enough to recognize a soul, not its whole identifier. */
const shortId = (almaId: string) => {
  const local = almaId.slice(almaId.lastIndexOf(":") + 1);
  return `${local.slice(0, 6)}…${local.slice(-4)}`;
};

/**
 * The soul as a card to show around: its character, its tribe (color, biome icon and name), the Founder seal if it
 * has it, its short identifier and where the village is. Nothing private: no account, no Cardano credential.
 */
export function SoulCard({ almaId, characterClass, tribe, founder, ref }: SoulCardProps & { ref?: React.Ref<HTMLDivElement> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "es";
  const info = tribeByIndex(tribe);
  const cls = classByIndex(characterClass);
  const sheet = manifest.characters[String(characterClass)];
  const Icon = TRIBE_ICONS[tribe];
  if (!info || !cls || !sheet || !Icon) return null;
  const scale = 1.6;

  return (
    <div ref={ref} data-testid="soul-card" className="flex w-80 flex-col items-center gap-3 rounded-lg border-2 border-wood bg-surface p-6 text-center text-text" style={{ ["--tribe" as string]: `var(${info.colorToken})` }}>
      <p className="font-display text-xl">{worldConfig.name}</p>
      <div className="grid place-items-center rounded-full bg-[var(--tribe)]" style={{ width: sheet.frameWidth * scale + 24, height: sheet.frameWidth * scale + 24 }}>
        <div
          role="img"
          aria-label={cls.name[lang]}
          style={{
            width: sheet.frameWidth * scale,
            height: sheet.frameHeight * scale,
            backgroundImage: `url(${assetUrl(`characters/${characterClass}.webp`)})`,
            backgroundPosition: `0 ${-FACING_ROW * sheet.frameHeight * scale}px`,
            backgroundSize: `${(sheet.idle.length + sheet.walk.length) * sheet.frameWidth * scale}px auto`,
          }}
        />
      </div>
      <p className="font-display text-3xl text-[var(--tribe)]">{info.name[lang]}</p>
      <p className="inline-flex items-center gap-2 text-sm text-text-muted">
        <Icon aria-hidden className="size-4" />
        {cls.name[lang]} · {info.biome[lang]}
      </p>
      {founder && (
        <p className="inline-flex items-center gap-1 rounded-sm bg-accent px-2 py-0.5 text-sm font-bold text-on-accent">
          <Stamp aria-hidden className="size-4" />
          {t("founder.badge")}
        </p>
      )}
      <p className="font-mono text-xs text-text-muted">{shortId(almaId)}</p>
      <p className="text-sm font-medium">{t("soulCard.where")}</p>
    </div>
  );
}

/** "Compartir": shows the card and shares it as an image. */
export function ShareSoulCard(props: SoulCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const { share, busy, outcome } = useShareSoulCard(props.almaId);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t("soulCard.open")}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t("soulCard.title")}>
        {open && (
          <div className="flex flex-col items-center gap-4">
            <SoulCard ref={card} {...props} />
            {outcome && (
              <p role={outcome === "failed" ? "alert" : "status"} className="text-sm">
                {t(`soulCard.${outcome}`)}
              </p>
            )}
            <Button disabled={busy} onClick={() => card.current && void share(card.current, t("soulCard.shareTitle"))}>
              {busy ? t("soulCard.drawing") : t("soulCard.share")}
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
