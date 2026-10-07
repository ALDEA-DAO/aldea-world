/**
 * Where the relay reads a proposal's tally from and where it publishes it before queueing.
 *
 * With a Pinata key the tally's exact bytes are pinned to IPFS and the URI is `ipfs://<cid>`. Without one, the URI is
 * the read model's own public address for that tally: enough to verify (the hash on-chain is what binds it), but only
 * as available as that node.
 */

export function createTallySource(effectstreamUrl: string) {
  const url = (proposalId: string) => `${effectstreamUrl.replace(/\/$/, "")}/api/v1/council/proposals/${proposalId}/tally.json`;
  return {
    url,
    async fetchTally(proposalId: string): Promise<string> {
      const res = await fetch(url(proposalId));
      if (!res.ok) throw new Error(`tally of ${proposalId}: ${res.status} from the read model`);
      return res.text();
    },
  };
}

export function createTallyPublisher({ pinataJwt, publicUrl }: { pinataJwt?: string; publicUrl: (proposalId: string) => string }) {
  return async (proposalId: string, tallyJson: string): Promise<string> => {
    if (!pinataJwt) return publicUrl(proposalId);
    const form = new FormData();
    form.append("file", new Blob([tallyJson], { type: "application/json" }), `tally-${proposalId}.json`);
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
    const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: { Authorization: `Bearer ${pinataJwt}` }, body: form });
    if (!res.ok) throw new Error(`pinning the tally of ${proposalId}: ${res.status}`);
    const { IpfsHash } = (await res.json()) as { IpfsHash?: string };
    if (!IpfsHash) throw new Error(`pinning the tally of ${proposalId}: no CID in the answer`);
    return `ipfs://${IpfsHash}`;
  };
}
