import { COUNCIL_OPENS_AT } from "@aldea/shared/catalog";
import type { CouncilChoice } from "@aldea/shared/council";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/Skeleton";
import { isSignedIn } from "../auth/AlmaAuthProvider";
import { useAlmaSession } from "../auth/useAlmaSession";
import { useLinks } from "../auth/useLinks";
import { CharterStatus, moment, RuleExplainer, WhatIsRatified } from "../council/CharterView";
import type { Charter } from "../council/councilApi";
import { TallyView, VerifyCharter } from "../council/TallyView";
import { useCharter } from "../council/useCharter";
import { VoteDialog } from "../council/VoteDialog";
import { useIsFounder } from "../founders/FounderSeal";
import { formatAldea } from "../founders/useFounder";
import { track } from "../../lib/analytics";

/**
 * The Council: the Genesis Charter, with which those who hold $ALDEA found the world on a version of its code. What
 * is ratified, the rule, your voice (sign or object, with your Cardano wallet and no gas), how it is going, and how
 * to verify all of it. Before a Charter is opened: when it will be, and what will be decided here.
 */
export function Council() {
  const { t, i18n } = useTranslation();
  const { status: session, almaId } = useAlmaSession();
  const { links } = useLinks();
  const credential = links?.find((link) => link.kind === "cardano")?.display.replace(/^cardano:/, "");
  const { status, charter, version, refresh } = useCharter(credential);
  const charterStatus = charter?.proposal.status;
  useEffect(() => {
    if (charterStatus) track("charter_viewed", { status: charterStatus });
  }, [charterStatus]);
  const opensAt = COUNCIL_OPENS_AT ? new Date(COUNCIL_OPENS_AT) : undefined;

  return (
    <div className="flex flex-col gap-4" data-testid="council">
      <h3 className="font-display text-xl">{t("council.charter")}</h3>
      {status === "loading" && <Skeleton variant="block" className="h-40" />}
      {status === "failed" && <p role="alert">{t("council.unavailable")}</p>}
      {status === "none" && (
        <>
          <p role="status">
            {opensAt && !Number.isNaN(opensAt.getTime()) ? t("council.opensOn", { date: opensAt.toLocaleDateString(i18n.language, { dateStyle: "long" }) }) : t("council.opensSoon")}
          </p>
          <p className="text-sm text-text-muted">{t("council.whatItIs")}</p>
        </>
      )}
      {status === "ready" && charter && (
        <>
          <CharterStatus charter={charter} version={version} />
          <WhatIsRatified charter={charter} version={version} />
          <RuleExplainer charter={charter} />
          <YourVoice charter={charter} signedIn={isSignedIn(session)} almaId={almaId} credential={credential} onVoted={refresh} />
          <TallyView charter={charter} />
          <VerifyCharter charter={charter} />
        </>
      )}
    </div>
  );
}

/**
 * "Tu voz": a Founder's weight and the two things they can do with it. Whoever is not a Founder is shown the way to
 * become one instead; whoever had no $ALDEA at the snapshot is told so, with its date.
 */
function YourVoice({ charter, signedIn, almaId, credential, onVoted }: { charter: Charter; signedIn: boolean; almaId?: string; credential?: string; onVoted: () => void }) {
  const { t, i18n } = useTranslation();
  const [voting, setVoting] = useState<CouncilChoice>();
  /** What was just published here: the read model takes from a moment to a minute or two to count it. */
  const [published, setPublished] = useState<{ choice: CouncilChoice; changed: boolean }>();
  const sealed = useIsFounder(almaId);
  const { proposal, voter } = charter;
  const founder = sealed || Boolean(voter?.founder);
  const open = proposal.status === "open";
  const counted = voter?.vote?.choice;
  const current = published?.choice ?? counted;
  const waiting = published !== undefined && counted !== published.choice;

  const body = (() => {
    if (proposal.status === "scheduled" || proposal.status === "snapshotted") return <p className="text-sm">{t("council.voice.notOpenYet", { date: moment(proposal.startsAt, i18n.language) })}</p>;
    if (!open) {
      return (
        <p className="text-sm">
          {t("council.voice.closed")} {counted && t(counted === "sign" ? "council.voice.signed" : "council.voice.objected")}
        </p>
      );
    }
    if (!signedIn) return <p className="text-sm">{t("council.voice.signIn")}</p>;
    if (!founder || !credential) {
      return (
        <p className="text-sm" data-testid="voice-not-founder">
          {t("council.voice.notFounder")}{" "}
          <Link className="underline" to="/b/registro-de-almas">
            {t("council.voice.howToFounder")}
          </Link>
        </p>
      );
    }
    if (!voter || BigInt(voter.weight) === 0n) return <p className="text-sm">{t("council.voice.noWeight", { date: moment(proposal.snapshotAt, i18n.language) })}</p>;
    return (
      <>
        <p className="text-sm" data-testid="voice-weight">
          {t("council.voice.weight", { amount: formatAldea(voter.weight, i18n.language) })}
        </p>
        {current && (
          <p role="status" className="text-sm font-medium" data-testid="voice-current">
            {published?.changed
              ? t("council.voice.changedTo", { choice: t(current === "sign" ? "council.voice.choiceSign" : "council.voice.choiceObject") })
              : t(current === "sign" ? "council.voice.signed" : "council.voice.objected")}{" "}
            {waiting && t("council.voice.counting")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {current ? (
            <Button variant="secondary" onClick={() => setVoting(current === "sign" ? "object" : "sign")}>
              {t("council.voice.change")}
            </Button>
          ) : (
            <>
              <Button onClick={() => setVoting("sign")}>{t("council.voice.sign")}</Button>
              <Button variant="secondary" onClick={() => setVoting("object")}>
                {t("council.voice.object")}
              </Button>
            </>
          )}
        </div>
        {credential && (
          <VoteDialog
            open={voting !== undefined}
            onClose={() => setVoting(undefined)}
            proposalId={proposal.proposalId}
            choice={voting ?? "sign"}
            credential={credential}
            onVoted={(choice) => {
              setPublished({ choice, changed: current !== undefined });
              onVoted();
            }}
          />
        )}
      </>
    );
  })();

  return (
    <section aria-labelledby="council-voice" className="flex flex-col items-start gap-2" data-testid="council-voice">
      <h4 id="council-voice" className="font-display text-lg">
        {t("council.voice.title")}
      </h4>
      {body}
    </section>
  );
}
