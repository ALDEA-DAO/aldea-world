# Security policy

ALDEA World runs smart contracts on Base and services that issue sessions and attestations. We take reports seriously
and appreciate responsible disclosure.

## Reporting a vulnerability

- Use **GitHub private vulnerability reporting** ("Security" tab → "Report a vulnerability") on this repository.
- Do not open public issues, pull requests or discussions about the vulnerability.
- Include the affected component (contract, service, client), a description, the impact and steps or a proof of
  concept on a local chain or a testnet. Never test against mainnet contracts or other players' accounts.

We acknowledge reports within 72 hours and keep you updated until the fix is released. We credit reporters who wish to
be credited.

## Scope

- Contracts: `packages/contracts` (MUD World) and `packages/protocol` (ALMA registry, Atlas, Council executor).
- Services: ALMA Resolver, Effectstream node, relay worker.
- The web client and the publishing pipeline for aldea.world (official version by CID).

Out of scope: third-party services (Privy, the paymaster, RPC providers), social engineering and denial of service.

## Known trust assumptions

Some roles are operated by AdaSouls as declared temporary trust (Founder attestation signer, relayer, repository
administration); they are documented in [GOVERNANCE.md](GOVERNANCE.md). Issues that follow from those documented
assumptions are not vulnerabilities, but ways to reduce them are welcome.
