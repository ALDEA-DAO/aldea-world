import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { isSignedIn } from "./AlmaAuthProvider";
import { useAlmaSession } from "./useAlmaSession";

/**
 * Guard for actions that write. Guests see why the action is unavailable and a way forward ("Sign in to…"), never a
 * silent failure; everything that only reads stays open to them.
 */
export function RequireSession({ action, children }: { action: string; children: ReactNode }) {
  const { t } = useTranslation();
  const { status, signIn } = useAlmaSession();
  if (isSignedIn(status)) return <>{children}</>;
  return (
    <Button variant="secondary" disabled={status === "loading"} onClick={() => void signIn()}>
      {t("auth.signInTo", { action })}
    </Button>
  );
}
