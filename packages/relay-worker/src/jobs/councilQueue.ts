import { canonicalHash, tallyIsConsistent, type CouncilTally } from "@aldea/shared/council";
import type { CouncilChain } from "../chain";
import type { Outbox } from "../db";
import { createOutboxJob, type JobDeps } from "./runner";

/**
 * Queues an approved Council result on-chain. The relay does not take the read model's word for it: it downloads the
 * full tally, recomputes its hash and its result, and only then publishes the tally and calls `queue`. A tally that
 * does not add up is never queued; it raises an alert at once.
 *
 * From there the delay runs, and the guardian can still veto.
 */

export interface CouncilQueueDeps extends JobDeps {
  outbox: Pick<Outbox, "pendingQueues" | "recordAttempt">;
  chain: CouncilChain;
  /** The canonical tally of a proposal, as the read model serves it (`…/tally.json`). */
  fetchTally: (proposalId: string) => Promise<string>;
  /** Publishes the tally's bytes where anyone can fetch them and returns the URI that goes on-chain. */
  publishTally: (proposalId: string, tallyJson: string) => Promise<string>;
}

export class TallyMismatch extends Error {}

/** Why a downloaded tally cannot be queued under `expected`, or undefined when it can. */
export function tallyProblem(tally: CouncilTally, expected: { proposalId: string; versionId: string; tallyHash: string }): string | undefined {
  if (canonicalHash(tally) !== expected.tallyHash.toLowerCase()) return "its hash is not the one computed at the close";
  if (tally.proposalId !== expected.proposalId.toLowerCase() || tally.versionId !== expected.versionId.toLowerCase()) return "it is the tally of another proposal or version";
  if (!tallyIsConsistent(tally)) return "its result is not what its snapshot and votes give";
  if (tally.result.outcome !== "approved") return "it was not approved";
  return undefined;
}

export function createCouncilQueueJob({ outbox, chain, fetchTally, publishTally, alert, log = () => {}, ...deps }: CouncilQueueDeps) {
  /** Rows already reported as not adding up: one alert each, however often they are retried. */
  const reported = new Set<number>();
  return createOutboxJob(
    {
      name: "councilQueue",
      pending: () => outbox.pendingQueues(),
      async run({ id, proposalId, versionId, tallyHash }) {
        const tallyJson = await fetchTally(proposalId);
        let problem: string | undefined;
        try {
          problem = tallyProblem(JSON.parse(tallyJson) as CouncilTally, { proposalId, versionId, tallyHash });
        } catch {
          problem = "it is not a tally";
        }
        if (problem) {
          if (!reported.has(id)) alert("the Council tally does not add up: not queued", { proposalId, tallyHash, problem });
          reported.add(id);
          throw new TallyMismatch(`tally of ${proposalId}: ${problem}`);
        }
        // Simulated with a placeholder URI first: nothing is published for a proposal that cannot be queued
        const simulation = await chain.simulateQueue(proposalId, versionId, tallyHash, "");
        if (simulation === "too_early") return "wait";
        if (simulation === "done") {
          await outbox.recordAttempt(id, { error: "already_queued" });
          log("council result already queued (or vetoed)", { proposalId });
          return "settled";
        }
        const tallyURI = await publishTally(proposalId, tallyJson);
        const txHash = await chain.queue(proposalId, versionId, tallyHash, tallyURI);
        await outbox.recordAttempt(id, { txHash });
        log("council result queued", { proposalId, tallyHash, tallyURI, txHash });
        return "settled";
      },
      describe: ({ proposalId }) => ({ proposalId }),
    },
    outbox,
    { alert, ...deps },
  );
}
