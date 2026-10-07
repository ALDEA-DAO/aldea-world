import type { CouncilChain } from "../chain";
import type { Outbox } from "../db";
import { createOutboxJob, type JobDeps } from "./runner";

/**
 * Executes a queued Council result once its delay has passed: the ratified version becomes the world's official one.
 * Anyone can call `execute`; the relay does it so nobody has to. A vetoed result is simply left alone.
 */

export interface CouncilExecuteDeps extends JobDeps {
  outbox: Pick<Outbox, "pendingExecutions" | "recordAttempt">;
  chain: CouncilChain;
}

export function createCouncilExecuteJob({ outbox, chain, log = () => {}, ...deps }: CouncilExecuteDeps) {
  const now = deps.now ?? Date.now;
  return createOutboxJob(
    {
      name: "councilExecute",
      pending: () => outbox.pendingExecutions(),
      /** The results whose delay has passed by this clock; Base's clock has the last word in the simulation. */
      ready: async (due) => due.filter((p) => now() >= p.eta * 1000),
      async run({ id, proposalId }) {
        const simulation = await chain.simulateExecute(proposalId);
        if (simulation === "too_early") return "wait";
        if (simulation === "done") {
          await outbox.recordAttempt(id, { error: "already_executed" });
          log("council result already executed (or vetoed)", { proposalId });
          return "settled";
        }
        const txHash = await chain.execute(proposalId);
        await outbox.recordAttempt(id, { txHash });
        log("council result executed", { proposalId, txHash });
        return "settled";
      },
      describe: ({ proposalId }) => ({ proposalId }),
    },
    outbox,
    deps,
  );
}
