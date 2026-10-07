import type { BirthChain } from "../chain";
import type { Outbox } from "../db";
import { createOutboxJob, type JobDeps } from "./runner";

/**
 * The Midwife: completes the births Effectstream queued in the outbox as soon as their target block exists.
 *
 * - A completion is sent once: after a success (or finding it already completed) the row is left to the STF, which
 *   closes it when it sees `CharacterBorn`. If the relay restarts meanwhile, the simulation answers
 *   `already_completed` and nothing is sent.
 * - Failures retry with a backoff of 2, 4, 8 and 16 s; three in a row raise an alert.
 */

export interface CompleteBirthDeps extends JobDeps {
  outbox: Pick<Outbox, "pendingCompletions" | "recordAttempt">;
  chain: BirthChain;
}

export function createCompleteBirthJob({ outbox, chain, log = () => {}, ...deps }: CompleteBirthDeps) {
  return createOutboxJob(
    {
      name: "completeBirth",
      pending: () => outbox.pendingCompletions(),
      /** The births whose target block exists. */
      async ready(due) {
        const head = await chain.head();
        return due.filter((p) => head >= p.notBeforeBlock);
      },
      async run({ id, characterId }) {
        const simulation = await chain.simulateCompleteBirth(characterId);
        if (simulation === "not_ready") return "wait";
        if (simulation === "already_completed") {
          await outbox.recordAttempt(id, { error: "already_completed" });
          log("birth already completed", { characterId });
        } else {
          const txHash = await chain.completeBirth(characterId);
          await outbox.recordAttempt(id, { txHash });
          log("birth completed", { characterId, txHash });
        }
        return "settled";
      },
      describe: ({ characterId }) => ({ characterId }),
    },
    outbox,
    deps,
  );
}
