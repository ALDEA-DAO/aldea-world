import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { useToast } from "../../components/ui/Toast";
import { RequireSession } from "../auth/RequireSession";
import { useWaitlist, type WaitlistBuilding } from "./useWaitlist";

/** "Anotarme": joins the building's waitlist (guests are asked to sign in first); once listed, says so. */
export function WaitlistButton({ building }: { building: WaitlistBuilding }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { loading, listed, joining, join } = useWaitlist(building);
  return (
    <RequireSession action={t("waitlist.signUpAction")}>
      {listed ? (
        <p role="status" className="font-medium">
          {t("waitlist.listed")}
        </p>
      ) : (
        <Button disabled={loading || joining} onClick={() => void join().catch(() => toast.show(t("waitlist.failed"), "error"))}>
          {t("waitlist.signUp")}
        </Button>
      )}
    </RequireSession>
  );
}
