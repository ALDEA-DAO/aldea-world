import { defineWorld } from "@latticexyz/world";

export default defineWorld({
  namespace: "aldea",
  enums: {
    // The order is canonical: it matches woldr and packages/shared/src/catalog.ts
    CharacterClass: [
      "Archer", "Alchemist", "Artisan", "Blacksmith", "Chef", "Magician",
      "Merchant", "Priest", "Tailor", "Rebel", "Warrior",
    ],
    Tribe: ["Amazonians", "Himalayans", "Poseidons", "Raes", "Tropicals"],
    BirthStatus: ["None", "Gestating", "Born"],
    BuildingKind: ["TownCenter", "Portal", "SoulRegistry", "Council", "VelumArchive", "NpcForge"],
  },
  tables: {
    // Global parameters (singleton). Only AdminSystem writes.
    Config: {
      schema: {
        almaRegistry: "address",       // AlmaAnchorRegistry on this chain
        founderAttestor: "address",    // EIP-712 signer of FounderAttestation
        minFounderBalance: "uint128",  // minimum $ALDEA in base units (6 decimals)
        genesisEndsAt: "uint64",       // unix seconds; while block.timestamp < genesisEndsAt only Founders are born (0 = no Genesis)
        birthDelayBlocks: "uint16",    // blocks between the request and the draw (default 3)
        paused: "bool",                // emergency pause for requestBirth, enterBuilding and claimFounder
      },
      key: [],
    },
    // Census (singleton). Replaces woldr's `World` table.
    Census: {
      schema: {
        lastCharacterId: "uint32",     // last assigned id (includes the gestating ones)
        totalPopulation: "uint32",     // characters born (status Born)
        gestating: "uint32",           // characters in Gestating
        classPopulation: "uint32[11]", // born per class, index = CharacterClass
        tribePopulation: "uint32[5]",  // born per tribe, index = Tribe
      },
      key: [],
    },
    Character: {
      schema: {
        id: "uint32",                  // 1..n, globally sequential
        owner: "address",              // the player's smart account (_msgSender)
        almaIdHash: "bytes32",         // keccak256(utf8(almaId)) of the owning human soul
        characterClass: "CharacterClass",
        tribe: "Tribe",                // valid only if status == Born
        status: "BirthStatus",
        targetBlock: "uint64",         // block whose hash decides the tribe
        requestedAt: "uint64",         // unix seconds
        bornAt: "uint64",              // unix seconds; 0 while gestating
      },
      key: ["id"],
    },
    // Uniqueness indexes: 1 person = 1 character (per account and per soul)
    CharacterOf: { schema: { owner: "address", characterId: "uint32" }, key: ["owner"] },
    SoulCharacter: { schema: { almaIdHash: "bytes32", characterId: "uint32" }, key: ["almaIdHash"] },
    // Tribe catalog: each tribe is an ALMA organization
    TribeInfo: {
      schema: { tribe: "Tribe", almaOrgIdHash: "bytes32", name: "string" },
      key: ["tribe"],
    },
    Building: {
      schema: {
        id: "bytes32",                 // keccak256("aldea.building.<slug>")
        kind: "BuildingKind",
        x: "int32",                    // door coordinates on the isometric grid
        y: "int32",
        isOpen: "bool",                // can be entered
        underConstruction: "bool",     // shown as under construction (Archive, Forge)
        name: "string",
      },
      key: ["id"],
    },
    // Last building where each character was seen (buildingId = 0x0 if outside)
    Location: {
      schema: { characterId: "uint32", buildingId: "bytes32", enteredAt: "uint64" },
      key: ["characterId"],
    },
    // Founder seal (Should)
    Founder: {
      schema: {
        almaIdHash: "bytes32",
        cardanoStakeCredential: "bytes28", // blake2b-224 of the stake credential
        aldeaBalance: "uint128",           // attested balance in base units
        snapshotSlot: "uint64",            // Cardano slot of the attested balance
        claimedAt: "uint64",
      },
      key: ["almaIdHash"],
    },
    // A stake credential seals a single soul
    FounderByStake: {
      schema: { cardanoStakeCredential: "bytes28", almaIdHash: "bytes32" },
      key: ["cardanoStakeCredential"],
    },
    // Anti-replay for EIP-712 attestations
    UsedAttestation: { schema: { digest: "bytes32", used: "bool" }, key: ["digest"] },
  },
  systems: {
    AdminSystem: { openAccess: false }, // only the namespace owner (the Safe)
  },
});
