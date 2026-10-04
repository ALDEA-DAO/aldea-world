import { useTranslation } from "react-i18next";
import { MonoId } from "../../components/ui/MonoId";
import { Skeleton } from "../../components/ui/Skeleton";
import { StatusPill, type StatusTone } from "../../components/ui/StatusPill";
import { useVersion, type VersionInfo } from "./version";

const tones: Record<VersionInfo["state"], StatusTone> = { official: "success", candidate: "warning", fork: "neutral", unofficial: "warning", development: "neutral", unknown: "neutral" };

/**
 * "About this version": what this client claims to be (its `/version.json`) and what the Atlas says about that claim.
 * "Official" is only shown when the chain confirms it.
 */
export function AboutVersion() {
  const { t } = useTranslation();
  const version = useVersion();
  return (
    <section aria-labelledby="about-version" className="mt-8 flex flex-col gap-2">
      <h2 id="about-version" className="text-sm font-medium">
        {t("version.about")}
      </h2>
      {!version ? (
        <Skeleton className="h-6 w-48" />
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <StatusPill tone={tones[version.state]}>{t(`version.state.${version.state}`)}</StatusPill>
            <span className="text-sm">{t(`version.explain.${version.state}`)}</span>
          </p>
          {version.state === "unofficial" && version.officialUrl && (
            <p className="text-sm">
              <a href={version.officialUrl} className="underline underline-offset-4">
                {t("version.goToOfficial")}
              </a>
            </p>
          )}
          {version.claim && (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-text-muted">{t("version.semver")}</dt>
              <dd>{version.claim.semver}</dd>
              <dt className="text-text-muted">{t("version.versionId")}</dt>
              <dd>
                <MonoId value={version.claim.versionId} short />
              </dd>
              <dt className="text-text-muted">{t("version.cid")}</dt>
              <dd>
                <MonoId value={version.claim.clientCid} />
              </dd>
              <dt className="text-text-muted">{t("version.commit")}</dt>
              <dd className="font-mono text-xs break-all">{version.claim.gitCommit}</dd>
            </dl>
          )}
        </>
      )}
    </section>
  );
}
