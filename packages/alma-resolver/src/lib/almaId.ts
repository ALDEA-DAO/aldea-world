import { isAlmaId, type AlmaSubjectType } from "@aldea/shared/alma";
import { ProblemError } from "./problem";

/**
 * Validates ALMA identifiers with the rules AlmaAnchorRegistry enforces on-chain (`alma:main:<human|org|agent>:`
 * + `[a-z0-9-]{1,64}`).
 *
 * TODO: switch to @adasouls/alma-core's parseIdentifier once the release that accepts `org` is on npm
 * (AdaSouls/alma accepts `org` as the short form of `organization`).
 */
export function assertAlmaId(id: string, type?: AlmaSubjectType): string {
  if (!isAlmaId(id, type)) {
    throw new ProblemError(400, "invalid_alma_id", "Invalid ALMA identifier", `Expected alma:main:${type ?? "<type>"}:<local-id>`);
  }
  return id;
}
