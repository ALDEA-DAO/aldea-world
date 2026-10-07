import { useTranslation } from "react-i18next";
import { SoulChip } from "../../components/hud/SoulChip";
import { Button } from "../../components/ui/Button";
import { useBirth } from "../birth/useBirth";
import { useIsFounder } from "../founders/FounderSeal";
import { useAlmaSession } from "./useAlmaSession";

/** Header control: "Entrar" for guests, the soul and "Salir" for players. */
export function SignInWithAlma() {
  const { t } = useTranslation();
  const { status, almaId, signIn, signOut } = useAlmaSession();
  const { character } = useBirth();
  const founder = useIsFounder(almaId);

  if (status === "loading") return null;
  if (status === "guest") {
    return (
      <Button size="sm" onClick={() => void signIn()}>
        {t("auth.signIn")}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {almaId && <SoulChip almaId={almaId} tribe={character?.status === 2 ? character.tribe : undefined} founder={founder} />}
      <Button size="sm" variant="ghost" className="!text-on-wood" onClick={() => void signOut()}>
        {t("auth.signOut")}
      </Button>
    </div>
  );
}

/** Full-screen state while coming back from ALMA Auth, and the retry prompt when the sign-in failed. */
export function AuthReturnState() {
  const { t } = useTranslation();
  const { returning, signInFailed, signIn } = useAlmaSession();

  if (returning) {
    return (
      <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-background/95">
        <p className="font-display text-2xl">{t("auth.lookingForSoul")}</p>
      </div>
    );
  }
  if (signInFailed) {
    return (
      <div role="alert" className="mx-auto mt-4 flex max-w-md flex-col items-center gap-3 rounded-md bg-surface-raised p-4 text-center">
        <p>{t("auth.failed")}</p>
        <Button onClick={() => void signIn()}>{t("auth.retry")}</Button>
      </div>
    );
  }
  return null;
}
