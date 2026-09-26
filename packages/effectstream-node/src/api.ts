import type { StartConfigApiRouter } from "@effectstream/node-sdk/runtime";

const BIRTH_STATUS = new Set(["gestating", "born"]);

/** Custom read API (docs/prd.md § 4.6), next to the node's default endpoints. */
export const apiRouter: StartConfigApiRouter = async (server, dbConn) => {
  server.get<{ Params: { characterId: string } }>("/api/v1/births/:characterId", async (request, reply) => {
    const id = Number(request.params.characterId);
    if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "invalid_character_id" });
    const { rows } = await dbConn.query(
      `SELECT character_id, status, tribe, character_class, target_block, requested_tx, born_tx FROM births WHERE character_id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: "birth_not_found" });
    if (!BIRTH_STATUS.has(row.status)) return reply.code(500).send({ error: "invalid_status" });
    return {
      characterId: row.character_id,
      status: row.status,
      tribe: row.tribe,
      characterClass: row.character_class,
      targetBlock: String(row.target_block),
      requestedTx: row.requested_tx,
      bornTx: row.born_tx,
    };
  });
};
