import { useTranslation } from "react-i18next";
import { VerifyOnChain } from "../../components/ui/VerifyOnChain";
import { formatAldea } from "../founders/useFounder";
import { tallyUrl, type Charter } from "./councilApi";

/** Share of `total`, 0 to 100, without leaving bigint until the last step (amounts do not fit a number). */
const percent = (part: string, total: string) => (BigInt(total) === 0n ? 0 : Number((BigInt(part) * 10_000n) / BigInt(total)) / 100);

/**
 * "Cómo va": what has signed, what has objected and how much of the eligible $ALDEA has spoken, as bars over the same
 * scale. Each bar reads as "label: amount" (never color alone), and the block announces its changes politely.
 */
export function TallyView({ charter }: { charter: Charter }) {
  const { t, i18n } = useTranslation();
  const { eligible, signatures, objections, participants } = charter.tally;
  const amount = (value: string) => formatAldea(value, i18n.language);
  const spoken = (BigInt(signatures) + BigInt(objections)).toString();
  const bars = [
    { key: "signatures", value: signatures, color: "var(--color-secondary)" },
    { key: "objections", value: objections, color: "var(--color-error)" },
    { key: "turnout", value: spoken, color: "var(--color-accent)" },
  ] as const;

  return (
    <section aria-labelledby="council-tally" data-testid="council-tally">
      <h4 id="council-tally" className="mb-2 font-display text-lg">
        {t("council.tally.title")}
      </h4>
      <ul className="flex flex-col gap-2" aria-live="polite">
        {bars.map((bar) => (
          <li key={bar.key} data-testid={`tally-${bar.key}`} className="grid grid-cols-[7rem_1fr] items-center gap-x-2 text-sm sm:grid-cols-[7rem_1fr_auto]">
            <span>{t(`council.tally.${bar.key}`)}</span>
            <span aria-hidden className="h-3 rounded-[4px] bg-surface">
              <span className="block h-3 rounded-[4px] transition-[width] duration-slow ease-out-soft" style={{ width: `${Math.min(100, percent(bar.value, eligible))}%`, background: bar.color }} />
            </span>
            <span className="col-span-2 font-bold tabular-nums sm:col-span-1 sm:text-right">
              {amount(bar.value)} $ALDEA · {percent(bar.value, eligible).toLocaleString(i18n.language, { maximumFractionDigits: 2 })} %
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-text-muted">
        {t("council.tally.voices", { count: participants })} · {t("council.tally.eligible", { amount: amount(eligible) })}
      </p>
    </section>
  );
}

/** "Verificar": everything needed to check the Charter without trusting this page. */
export function VerifyCharter({ charter }: { charter: Charter }) {
  const { t } = useTranslation();
  const { proposal, result, voter } = charter;
  const facts: [string, string | null | undefined][] = [
    ["opened", proposal.openedTx],
    ["yourVote", voter?.vote?.inputTx],
    ["queued", proposal.queuedTx],
    ["executed", proposal.executedTx],
    ["vetoed", proposal.vetoedTx],
  ];
  return (
    <section aria-labelledby="council-verify" data-testid="council-verify">
      <h4 id="council-verify" className="mb-2 font-display text-lg">
        {t("council.verify.title")}
      </h4>
      <ul className="flex flex-col gap-1 text-sm">
        {facts.map(
          ([key, tx]) =>
            tx && (
              <li key={key} className="flex flex-wrap items-center gap-2">
                <span>{t(`council.verify.${key}`)}</span>
                <VerifyOnChain txHash={tx} />
              </li>
            ),
        )}
        {proposal.paramsHash && (
          <li className="flex flex-wrap items-center gap-2">
            <span>{t("council.verify.rules")}</span>
            <span className="font-mono text-xs break-all" title={proposal.paramsHash}>
              {proposal.paramsURI}
            </span>
          </li>
        )}
        {result && (
          <li className="flex flex-col gap-1">
            <a className="underline" href={tallyUrl(proposal.proposalId)} target="_blank" rel="noreferrer" data-testid="tally-json">
              {t("council.verify.tally")}
            </a>
            <span>
              {t("council.verify.tallyHash")} <span className="font-mono text-xs break-all">{result.tallyHash}</span>
            </span>
            <span className="text-text-muted">{t("council.verify.recompute")}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
