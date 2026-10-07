import { useTranslation } from "react-i18next";
import { MonoId } from "../../components/ui/MonoId";
import type { AtlasVersion } from "../atlas/atlasApi";
import type { Charter } from "./councilApi";

const REPOSITORY = "https://github.com/ALDEA-DAO/aldea-world";

/** A moment as the Charter states it: the day and the time, in the reader's language and time zone. */
export const moment = (seconds: number, language: string) => new Date(seconds * 1000).toLocaleString(language, { dateStyle: "long", timeStyle: "short" });

/**
 * Where the Charter stands, in one sentence: before it opens, while it is open, its result once closed, the wait for
 * the delay (a date, never a countdown that hurries anyone), and how it ended.
 */
export function CharterStatus({ charter, version }: { charter: Charter; version?: AtlasVersion | null }) {
  const { t, i18n } = useTranslation();
  const { proposal, result } = charter;
  const at = (seconds: number) => moment(seconds, i18n.language);
  const outcome = result && <span>{t(result.outcome === "approved" ? "council.status.approved" : "council.status.rejected")}</span>;

  const lines = (() => {
    switch (proposal.status) {
      case "scheduled":
      case "snapshotted":
        return [t("council.status.scheduled", { date: at(proposal.startsAt) })];
      case "open":
        return [t("council.status.open", { date: at(proposal.endsAt) })];
      case "closed":
        return result ? [outcome, result.outcome === "approved" && t("council.status.waitingQueue")] : [t("council.status.noResult")];
      case "queued":
        return [outcome, proposal.eta !== null && t("council.status.queued", { date: at(proposal.eta) })];
      case "executed":
        return [t("council.status.executed", { semver: version?.semver ?? "" }).replace(/\s+\./, ".")];
      case "vetoed":
        return [t("council.status.vetoed"), proposal.vetoReason && t("council.status.vetoReason", { reason: proposal.vetoReason })];
    }
  })();

  return (
    <div role="status" data-testid="council-status" data-status={proposal.status} className="flex flex-col gap-1 rounded-md border border-border bg-surface-raised p-3 font-medium">
      {lines.filter(Boolean).map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}

/** "Qué se ratifica": the version of the world the Charter founds it with, by what identifies its code and its build. */
export function WhatIsRatified({ charter, version }: { charter: Charter; version?: AtlasVersion | null }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="council-what">
      <h4 id="council-what" className="mb-2 font-display text-lg">
        {t("council.what.title")}
      </h4>
      {version ? (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-sm">
          <dt>{t("council.what.version")}</dt>
          <dd className="font-bold" data-testid="charter-version">
            {version.semver}
          </dd>
          <dt>{t("council.what.cid")}</dt>
          <dd>
            <MonoId value={version.clientCid} short />
          </dd>
          <dt>{t("council.what.commit")}</dt>
          <dd>
            <a className="font-mono text-xs underline" href={`${REPOSITORY}/tree/${version.gitCommit.replace(/^0x/, "")}`} target="_blank" rel="noreferrer">
              {version.gitCommit.replace(/^0x/, "").slice(0, 10)}
            </a>
          </dd>
        </dl>
      ) : (
        <p className="text-sm">{version === null ? t("council.what.unknownVersion") : <MonoId value={charter.proposal.versionIds[0] ?? ""} short />}</p>
      )}
    </section>
  );
}

/** "La regla": approved unless there is a qualified objection, said plainly and drawn as the two conditions it takes. */
export function RuleExplainer({ charter }: { charter: Charter }) {
  const { t, i18n } = useTranslation();
  const { params, snapshotAt } = charter.proposal;
  return (
    <section aria-labelledby="council-rule">
      <h4 id="council-rule" className="mb-2 font-display text-lg">
        {t("council.rule.title")}
      </h4>
      {params ? (
        <>
          <p className="text-sm">{t("council.rule.text", { threshold: (params.objectionThresholdBps / 100).toLocaleString(i18n.language) })}</p>
          <ol className="my-2 flex flex-wrap items-center gap-2 text-xs" aria-label={t("council.rule.diagram")}>
            <li className="rounded-sm border border-border px-2 py-1">{t("council.rule.moreObjections")}</li>
            <li aria-hidden>+</li>
            <li className="rounded-sm border border-border px-2 py-1">{t("council.rule.reachThreshold", { threshold: (params.objectionThresholdBps / 100).toLocaleString(i18n.language) })}</li>
            <li aria-hidden>→</li>
            <li className="rounded-sm bg-surface-raised px-2 py-1 font-bold">{t("council.rule.rejected")}</li>
          </ol>
          <p className="text-sm text-text-muted">
            {t("council.rule.otherwise")} {t("council.rule.weight", { date: moment(snapshotAt, i18n.language) })}
          </p>
        </>
      ) : (
        <p className="text-sm">{t("council.rule.pending")}</p>
      )}
    </section>
  );
}
