import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { MonoId } from "../../components/ui/MonoId";
import { Panel } from "../../components/ui/Panel";
import { Skeleton } from "../../components/ui/Skeleton";
import { TribeChip } from "../../components/ui/TribeChip";
import { VerifyOnChain } from "../../components/ui/VerifyOnChain";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { RequireSession } from "../auth/RequireSession";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useBirth } from "../birth/useBirth";
import { useSoul } from "../soul/useSoul";
import { YourKeys } from "../soul/YourKeys";

/**
 * The Soul Registry: a soul's identity and its evidence. "Your soul" (the identifier, type, date and status), "Your
 * ties" (the tribe, with the birth transaction) and, on your own soul, "Your keys". `almaId` undefined shows the
 * signed-in soul.
 */
export function SoulRegistry({ almaId }: { almaId?: string }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Panel variant="inline" title={t("registry.title")}>
        <SoulRegistryContent almaId={almaId} />
      </Panel>
    </div>
  );
}

/** The registry's content, for the building panel in the village and for the standalone page of any soul. */
export function SoulRegistryContent({ almaId }: { almaId?: string }) {
  const { t, i18n } = useTranslation();
  const session = useAlmaSession();
  const { stage } = useBirth();
  const { soul, tribe, loading, failed, own } = useSoul(almaId, stage === "born");
  const guestOnOwn = almaId === undefined && !isSignedIn(session.status);

  return (
    <>
        {guestOnOwn ? (
          <div className="flex flex-col items-start gap-3">
            <p>{t("registry.notBornYet")}</p>
            <RequireSession action={t("registry.seeYourSoul")}>
              <span />
            </RequireSession>
          </div>
        ) : failed ? (
          <p role="alert">{t("registry.closed")}</p>
        ) : loading || !soul ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="flex flex-col gap-8">
            <section aria-labelledby="your-soul">
              <h2 id="your-soul" className="text-2xl">
                {own ? t("registry.yourSoul") : t("registry.aSoul")}
              </h2>
              <div className="mt-2">
                <MonoId value={soul.id} />
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {t(`registry.type.${soul.type}`)} · {new Date(soul.createdAt).toLocaleDateString(i18n.language)} · {t(`registry.status.${soul.status}`)}
              </p>
            </section>

            <section aria-labelledby="your-ties">
              <h2 id="your-ties" className="text-2xl">
                {own ? t("registry.yourTies") : t("registry.ties")}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {tribe ? (
                  <>
                    <TribeChip tribe={tribe.index} />
                    {tribe.txHash && <VerifyOnChain txHash={tribe.txHash} />}
                  </>
                ) : own && stage === "born" ? (
                  <p role="status">{t("registry.registeringTribe")}</p>
                ) : (
                  <p>
                    {own ? t("registry.notBornYet") : t("registry.noTies")}{" "}
                    {own && (
                      <Link className="underline" to="/b/centro-urbano">
                        {t("nav.townCenter")}
                      </Link>
                    )}
                  </p>
                )}
              </div>
            </section>

            {own && <YourKeys />}
          </div>
        )}
    </>
  );
}
