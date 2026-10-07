import { effectstreamApi } from "../../lib/effectstream";

/** A Council proposal a soul took part in, signing or objecting alike, with the transaction that carried its vote. */
export interface Participation {
  proposalId: string;
  kind: "GenesisRatification" | "SeasonElection";
  inputTx: string;
}

export async function fetchParticipations(almaIdHash: string): Promise<Participation[]> {
  return (await effectstreamApi<{ items: Participation[] }>(`/api/v1/council/participants/${almaIdHash}`)).items;
}
