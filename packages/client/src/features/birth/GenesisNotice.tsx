import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useLinks } from "../auth/useLinks";
import { LinkCardanoDialog } from "../founders/LinkCardanoDialog";

/**
 * "Fundadores primero": during Genesis only souls with the Founder seal are born. A holder links their Cardano wallet
 * here and is then born in one step (the seal is claimed with the birth); everyone else is told when the village
 * opens. No countdowns and no urgency: the date is a fact, not a push.
 *
 * `onLinked` tells the Town Center that the soul can now be born.
 */
export function GenesisNotice({ endsAt, onLinked }: { endsAt: Date; onLinked: () => void }) {
  const { t, i18n } = useTranslation();
  const { status } = useAlmaSession();
  const { links } = useLinks();
  const [linking, setLinking] = useState(false);
  const [linkedNow, setLinkedNow] = useState(false);
  const linked = linkedNow || Boolean(links?.some((link) => link.kind === "cardano"));

  return (
    <section data-testid="genesis-notice" aria-labelledby="genesis-notice" className="flex flex-col items-start gap-2 rounded-md border border-accent bg-surface-raised p-4">
      <h3 id="genesis-notice" className="font-display text-xl">
        {t("genesis.title")}
      </h3>
      <p className="text-sm">{t("genesis.explain")}</p>
      <p className="text-sm">{t("genesis.opens", { date: endsAt.toLocaleDateString(i18n.language, { year: "numeric", month: "long", day: "numeric" }) })}</p>
      {linked ? (
        <p role="status" className="text-sm font-medium">
          {t("genesis.linked")}
        </p>
      ) : (
        isSignedIn(status) && (
          <Button variant="secondary" size="sm" className="relative" onClick={() => setLinking(true)}>
            {t("genesis.link")}
          </Button>
        )
      )}
      <LinkCardanoDialog
        open={linking}
        onClose={() => setLinking(false)}
        onLinked={() => {
          setLinkedNow(true);
          onLinked();
        }}
      />
    </section>
  );
}
