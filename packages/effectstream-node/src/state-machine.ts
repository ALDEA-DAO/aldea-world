import { Stm, type BaseStfInput } from "@effectstream/node-sdk/sm";
import type { StartConfigGameStateTransitions } from "@effectstream/node-sdk/runtime";
import { type SyncStateUpdateStream, World } from "@effectstream/node-sdk/coroutine";
import { createScheduledData } from "@effectstream/node-sdk/db";
import { generatePrecompile } from "@effectstream/node-sdk/precompile";
import { AddressType } from "@effectstream/node-sdk/utils";
import { signerCredential } from "./cardano/credentials.ts";
import { env } from "./env.ts";
import { AldeaEvents } from "./events.ts";
import { grammar } from "./grammar.ts";
import { aldeaUtxo, type AldeaUtxo } from "./stf/aldea.ts";
import * as atlas from "./stf/atlas.ts";
import { birthCompleted, birthRequested, birthRescheduled, type BirthCompleted, type BirthRequested, type BirthRescheduled, type Effect, type StfContext } from "./stf/births.ts";
import { buildingEntered, buildingLeft, type BuildingEntered, type BuildingLeft } from "./stf/buildings.ts";
import * as council from "./stf/council.ts";
import { founderClaimed, type FounderClaimed } from "./stf/founders.ts";
import { soulAnchored, type SoulAnchored } from "./stf/souls.ts";
import { sql } from "./sql.ts";

/**
 * The state transitions: each one turns an on-chain event into read-model effects (src/stf/*) and real-time events.
 * Deterministic: only World.resolve, no Date, Math.random or I/O.
 *
 * Every input names a prefix of the grammar, and CouncilInputs lets anyone publish any input. So each transition
 * says where its inputs come from, and an input from anywhere else is dropped:
 *
 * - `chain`: an event or UTxO read by one of this node's primitives (nobody signs those);
 * - `timer`: scheduled by the state machine itself;
 * - `guardian`: published in CouncilInputs by the Council's guardian, from its own account;
 * - `voter`: published in CouncilInputs with a Cardano wallet's signature, which the engine has already verified.
 */
const rawStm = new Stm<typeof grammar, {}>(grammar);

type Origin = "chain" | "timer" | "guardian" | "voter";
/** The address the Council's timers are scheduled from: nobody can sign as it. */
const COUNCIL_TIMER = generatePrecompile("aldea-council-timer");

function comesFrom(origin: Origin, data: BaseStfInput): boolean {
  const type = Number(data.signerAddressType ?? AddressType.NONE);
  const address = String(data.signerAddress ?? "");
  switch (origin) {
    case "chain":
      return type === AddressType.NONE && address !== COUNCIL_TIMER;
    case "timer":
      return type === AddressType.NONE && address === COUNCIL_TIMER;
    case "guardian":
      return type === AddressType.EVM && env.council !== undefined && address.toLowerCase() === env.council.operator;
    case "voter":
      return type === AddressType.CARDANO;
  }
}

const stm = {
  addStateTransition(prefix: keyof typeof grammar, transition: (data: any) => Generator<any, void, any>, origin: Origin = "chain") {
    rawStm.addStateTransition(prefix as any, function* (data: any) {
      if (!comesFrom(origin, data)) return;
      yield* transition(data);
    });
  },
  processInput: (input: BaseStfInput) => rawStm.processInput(input),
};

function* apply(effects: Effect[]) {
  for (const [query, params] of effects) yield* World.resolve(query, params);
}

const context = (data: BaseStfInput): StfContext => ({ height: data.blockHeight, timestampMs: data.blockTimestamp, worldId: env.activityWorldId });

stm.addStateTransition("birthRequested", function* (data) {
  const input = data.parsedInput as BirthRequested;
  yield* apply(birthRequested(input, context(data)));
  data.emit(AldeaEvents.BirthUpdated, { characterId: input.characterId, status: "gestating", tribe: -1, bornTx: "" });
});

stm.addStateTransition("birthRescheduled", function* (data) {
  yield* apply(birthRescheduled(data.parsedInput as BirthRescheduled, context(data)));
});

stm.addStateTransition("birthCompleted", function* (data) {
  const input = data.parsedInput as BirthCompleted;
  yield* apply(birthCompleted(input, context(data)));
  data.emit(AldeaEvents.BirthUpdated, { characterId: input.characterId, status: "born", tribe: input.tribe, bornTx: input.txHash.toLowerCase() });
});

stm.addStateTransition("soulAnchored", function* (data) {
  yield* apply(soulAnchored(data.parsedInput as SoulAnchored));
});

stm.addStateTransition("buildingEntered", function* (data) {
  const input = data.parsedInput as BuildingEntered;
  yield* apply(buildingEntered(input, context(data)));
  data.emit(AldeaEvents.BuildingActivity, { buildingId: input.buildingId.toLowerCase(), characterId: input.characterId, kind: "entered" });
});

stm.addStateTransition("buildingLeft", function* (data) {
  const input = data.parsedInput as BuildingLeft;
  yield* apply(buildingLeft(input, context(data)));
  data.emit(AldeaEvents.BuildingActivity, { buildingId: input.buildingId.toLowerCase(), characterId: input.characterId, kind: "left" });
});

stm.addStateTransition("founderClaimed", function* (data) {
  yield* apply(founderClaimed(data.parsedInput as FounderClaimed));
});

stm.addStateTransition("aldeaUtxo", function* (data) {
  yield* apply(aldeaUtxo(data.parsedInput as AldeaUtxo, context(data)));
});

/**
 * Atlas events: the statement returns the world it changed (nothing on a replay), and that world is announced as
 * `registered` or `updated` for the Portal to refresh its row.
 */
function atlasTransition<Input>(prefix: keyof typeof grammar, effects: (input: Input, ctx: StfContext) => Effect[], event: "registered" | "updated") {
  stm.addStateTransition(prefix, function* (data: any) {
    for (const [query, params] of effects(data.parsedInput as Input, context(data))) {
      const rows = (yield* World.resolve(query, params)) as { world_id?: string }[];
      for (const row of rows ?? []) if (row.world_id) data.emit(AldeaEvents.AtlasWorldChanged, { worldId: row.world_id, event });
    }
  });
}

atlasTransition("atlasWorldRegistered", atlas.worldRegistered, "registered");
atlasTransition("atlasVersionRegistered", atlas.versionRegistered, "updated");
atlasTransition("atlasClientRegistered", atlas.clientRegistered, "updated");
atlasTransition("atlasClientDeactivated", atlas.clientDeactivated, "updated");
atlasTransition("atlasOfficialVersionSet", atlas.officialVersionSet, "updated");
atlasTransition("atlasVersionWithdrawn", atlas.versionWithdrawn, "updated");
atlasTransition("atlasGovernorChanged", atlas.governorChanged, "updated");
atlasTransition("atlasVisibilityChanged", atlas.visibilityChanged, "updated");
atlasTransition("atlasMetadataChanged", atlas.metadataChanged, "updated");
atlasTransition("atlasVerifiedChanged", atlas.verifiedChanged, "updated");

/** A Council proposal changed: tell whoever is watching it. */
function* announce(data: any, proposalId: string) {
  const rows = (yield* World.resolve(council.selectStatus, { proposal_id: proposalId.toLowerCase() })) as { status: string }[];
  if (rows?.[0]) data.emit(AldeaEvents.CouncilUpdated, { proposalId: proposalId.toLowerCase(), status: rows[0].status });
}

const timer = (prefix: "councilSnapshot" | "councilOpen" | "councilClose", proposalId: string, atSeconds: number) =>
  createScheduledData(JSON.stringify([prefix, proposalId]), { timestamp: atSeconds * 1000 } as any, { precompile: COUNCIL_TIMER } as any);

stm.addStateTransition("councilOpened", function* (data) {
  const input = data.parsedInput as council.CouncilOpened;
  for (const [query, params] of council.councilOpened(input)) {
    const rows = (yield* World.resolve(query, params)) as { proposal_id: string; snapshot_at: string; starts_at: string; ends_at: string }[];
    // A new proposal: its snapshot, opening and close happen at their times (a time already past, at the next block)
    for (const row of rows ?? []) {
      yield* timer("councilSnapshot", row.proposal_id, Number(row.snapshot_at));
      yield* timer("councilOpen", row.proposal_id, Number(row.starts_at));
      yield* timer("councilClose", row.proposal_id, Number(row.ends_at));
    }
  }
  yield* announce(data, input.proposalId);
});

stm.addStateTransition(
  "councilSnapshot",
  function* (data) {
    const { proposalId } = data.parsedInput as { proposalId: string };
    yield* apply(council.councilSnapshot(proposalId, context(data)));
    yield* announce(data, proposalId);
  },
  "timer",
);

stm.addStateTransition(
  "councilOpen",
  function* (data) {
    const { proposalId } = data.parsedInput as { proposalId: string };
    yield* apply(council.councilOpen(proposalId, context(data)));
    yield* announce(data, proposalId);
  },
  "timer",
);

stm.addStateTransition(
  "councilClose",
  function* (data) {
    const proposal_id = (data.parsedInput as { proposalId: string }).proposalId.toLowerCase();
    const ctx = context(data);
    const closed = (yield* World.resolve(council.closeProposal, { proposal_id, now: Math.floor(ctx.timestampMs / 1000) })) as council.ProposalRow[];
    if (!closed?.[0]) return;
    const snapshot = (yield* World.resolve(council.selectSnapshot, { proposal_id })) as { credential: string; weight: string }[];
    const votes = (yield* World.resolve(council.selectVotes, { proposal_id })) as Parameters<typeof council.tallyOf>[2];
    const tally = council.tallyOf(closed[0], snapshot ?? [], votes ?? []);
    if (tally) yield* apply(council.councilResult(tally, ctx));
    yield* announce(data, proposal_id);
  },
  "timer",
);

stm.addStateTransition(
  "cp",
  function* (data) {
    const input = data.parsedInput as { proposalId: string; params: string };
    yield* apply(council.councilParams(input, context(data)));
    yield* announce(data, input.proposalId);
  },
  "guardian",
);

/**
 * The Base transaction that published the input being processed. The engine keeps it next to the input until the
 * input has run, and it is the public evidence of a vote.
 */
const inputOrigin = sql<{ height: number; input: string; signer: string }, { tx_hash: string | null }>(
  `SELECT '0x' || encode(o.tx_hash, 'hex') AS tx_hash
FROM effectstream.rollup_inputs i
JOIN effectstream.rollup_input_origin o ON o.id = i.id
JOIN effectstream.rollup_input_future_block f ON f.id = i.id
WHERE f.future_block_height = :height! AND i.input_data = :input! AND i.from_address = :signer!
ORDER BY i.id LIMIT 1`,
);

stm.addStateTransition(
  "cv",
  function* (data) {
    const input = data.parsedInput as { proposalId: string; choice: "s" | "o" };
    const credential = signerCredential(String(data.signerAddress));
    if (!credential) return;
    const origin = (yield* World.resolve(inputOrigin, { height: data.blockHeight, input: data.conciseInput, signer: String(data.signerAddress) })) as { tx_hash: string | null }[];
    const counted = [];
    for (const [query, params] of council.vote(input, credential, origin?.[0]?.tx_hash ?? "", context(data))) counted.push(...(((yield* World.resolve(query, params)) as unknown[]) ?? []));
    if (counted.length) yield* announce(data, input.proposalId);
  },
  "voter",
);

for (const [prefix, effects] of [
  ["councilQueued", council.councilQueued],
  ["councilVetoed", council.councilVetoed],
  ["councilExecuted", council.councilExecuted],
] as const) {
  stm.addStateTransition(prefix, function* (data) {
    yield* apply((effects as (input: any, ctx: StfContext) => Effect[])(data.parsedInput, context(data)));
    yield* announce(data, (data.parsedInput as { proposalId: string }).proposalId);
  });
}

export const gameStateTransitions: StartConfigGameStateTransitions = function* (
  _blockHeight: number,
  input: BaseStfInput,
): SyncStateUpdateStream<void> {
  yield* stm.processInput(input);
};
