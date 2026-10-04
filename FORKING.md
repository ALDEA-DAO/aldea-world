# Forking ALDEA World

A fork is this same code, built with another name and palette, running on its own World contract and registered in the
Atlas as a child of the world it comes from. The Portal of every world then lists it with its lineage ("fork of ALDEA
World"), and its own client says "Fork version" in the top bar.

**You fork the world, not the brand.** The code is [MIT](LICENSE); the ALDEA name, lore and art are not part of that
license (see [LICENSE-ASSETS.md](LICENSE-ASSETS.md)). Give your world its own name and, before you launch it, its own
art.

This guide walks through a fork on your machine, against the local stack, which is the path that has been run end to
end. Doing the same on a public network needs the shared rails deployed there; that section is at the end.

## What you need

- This repository running locally: `pnpm install && pnpm dev` (see the [README](README.md#getting-started)).
- The [fork kit CLI](https://github.com/AdaSouls/fork-kit), which registers everything below in the Atlas.
- A key of your own. Locally any anvil account works (they are funded); the examples use anvil's account 6.

```bash
export FORK_KIT_PRIVATE_KEY=0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e
alias fk='fork-kit --deployment packages/shared/src/deployments/31337.json'
```

`--deployment` tells the CLI where the rails are; `31337.json` is written by `pnpm dev` and also holds
`aldeaWorldId`, the world you are forking.

## 1. A soul, an organization and the world

A world belongs to an organization, and an organization to a person's soul, so there are three steps:

```bash
fk soul create                                   # signs in with ALMA using your key and anchors your soul
fk org anchor --id alma:main:org:nocturna        # the organization that will own the world
fk world register --name "ALDEA Nocturna" --org alma:main:org:nocturna \
  --parent <aldeaWorldId from 31337.json>        # prints your worldId
```

Open <http://localhost:3000/#/portal>, tab "Todos": your world is there, as a fork of ALDEA World, within seconds.
It is not under "Verificados": only the Atlas curator verifies a world, and visitors get a warning before traveling
to an unverified one.

## 2. Your client

Build the client as your world. Three variables make the difference (`packages/client/.env.example`):

```bash
cd packages/client
VITE_WORLD_NAME="ALDEA Nocturna" VITE_WORLD_THEME=nocturna VITE_ALDEA_WORLD_ID=<your worldId> \
  pnpm exec vite build --outDir ../../nocturna-site
```

- `VITE_WORLD_NAME` is the name in the top bar and the page title.
- `VITE_WORLD_THEME` picks a palette from `src/styles/themes/`. `nocturna` (the village at night) is the example: copy
  `nocturna.css`, change the colors, and add its name to `WORLD_THEMES` in `src/theme/worldConfig.ts`.
- `VITE_ALDEA_WORLD_ID` is your world in the Atlas. With it the client knows it is a fork.

Serve `nocturna-site` with any static server and open it: your name, your palette, and "Versión de un fork" in the
top bar.

## 3. A version, and making it official

```bash
fk release --world <your worldId> --dir nocturna-site --semver 0.1.0 \
  --world-address <your World contract> --engine mud@2.2.23 --car nocturna.car
```

`release` computes the build's IPFS CID and registers it as a candidate version built from the current commit;
`--car` keeps the build as a CAR file. Your world's governor (you, unless you named another one) then makes it
official with `AtlasRegistry.setOfficialVersion(worldId, versionId)`.

```bash
fk publish --world <your worldId> --car nocturna.car --out site \
  --operator alma:main:org:nocturna --presence-url https://your-domain.example/presence
fk client register --version <versionId> --url https://your-domain.example \
  --kind web --operator alma:main:org:nocturna
```

`publish` only writes `site/` if the files add up to the CID the Atlas holds for your official version, and adds
`/version.json` and the client manifest (`/.well-known/aldea-world.json`) next to them. Deploy `site/` to your host,
and serve the manifest and your presence URL with `Access-Control-Allow-Origin: *`: other worlds' Portals read them
from the browser. `client register` is what puts the "Viajar" button on your card.

## On a public network

Not possible yet: the shared rails (`AlmaAnchorRegistry`, `AtlasRegistry`) and ALMA Auth are not deployed on Base
Sepolia or Base. Once they are, the steps above are the same with `--network base-sepolia` (or `base`) instead of
`--deployment`, plus what a local fork borrows from the stack it runs next to:

- **Your own World contract.** `packages/contracts` deployed to that network with `mud deploy`, pointed at the shared
  `AlmaAnchorRegistry` (`ALMA_REGISTRY_ADDRESS`, as `scripts/dev-deploy.sh` does locally).
- **Your own services.** An Effectstream node and a relay worker following your World (`packages/effectstream-node`,
  `packages/relay-worker`), and the client's `VITE_*` URLs pointing at them.
- **A key with funds** on that network for the registrations.
