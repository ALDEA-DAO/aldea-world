import { almaIdHash } from "@aldea/shared/alma";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { FounderBadge } from "../../components/ui/FounderBadge";
import { MonoId } from "../../components/ui/MonoId";
import { useWorld, type WorldState, type WorldTables } from "../../mud/store";
import { useLinks } from "../auth/useLinks";
import { LinkCardanoDialog, type CardanoLinked } from "./LinkCardanoDialog";
import { useFounder } from "./useFounder";

/** Whether a soul (any soul) has the Founder seal, as the synced World says. */
export function useIsFounder(almaId: string | undefined): boolean {
  const select = useCallback((state: WorldState, tables: WorldTables) => (almaId ? state.getValue(tables.Founder, { almaIdHash: almaIdHash(almaId) })?.claimedAt : undefined), [almaId]);
  const claimedAt = useWorld(select);
  return Boolean(claimedAt && claimedAt > 0n);
}

/**
 * The Founder seal on your own soul: the seal once claimed; before that, the way to it. Link your Cardano wallet
 * (a signature, no transaction), then claim the seal if it holds enough $ALDEA.
 */
export function FounderSeal() {
  const { t, i18n } = useTranslation();
  const { isFounder, ready, claiming, problem, claim } = useFounder(i18n.language);
  const { links } = useLinks();
  const [linking, setLinking] = useState(false);
  const [justLinked, setJustLinked] = useState<CardanoLinked>();
  const credential = justLinked?.link.value ?? links?.find((link) => link.kind === "cardano")?.display;

  if (isFounder) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <FounderBadge />
        {t("registry.sealHeld")}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-2">
      {credential ? (
        <>
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("founder.walletLinked")} <MonoId value={credential} short />
          </span>
          <Button size="sm" className="relative" disabled={!ready || claiming} onClick={() => void claim()}>
            {claiming ? t("founder.claiming") : t("founder.claim")}
          </Button>
        </>
      ) : (
        <>
          <span>{t("registry.founderNotYet")}</span>
          <Button variant="secondary" size="sm" className="relative" onClick={() => setLinking(true)}>
            {t("founder.link.title")}
          </Button>
        </>
      )}
      {problem && <span role="alert">{t(problem.copyKey, problem.values)}</span>}
      <LinkCardanoDialog open={linking} onClose={() => setLinking(false)} onLinked={setJustLinked} onClaim={() => void claim()} />
    </span>
  );
}
