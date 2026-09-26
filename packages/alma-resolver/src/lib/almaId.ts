import { isAlmaId, type AlmaSubjectType } from "@aldea/shared/alma";
import { ProblemError } from "./problem";

/**
 * Validates ALMA identifiers with the rules AlmaAnchorRegistry enforces on-chain (`alma:main:<human|org|agent>:`
 * + `[a-z0-9-]{1,64}`).
 *
 * TODO(open-question-9): switch to @adasouls/alma-core once it is published. Today it is private (GitHub Packages)
 * and its subject type is `organization` while ALDEA's contracts and PRD use `org` (`alma:main:org:tribu-…`), so
 * its `parseIdentifier` would reject every tribe id. See docs/decisions/0004-alma-core.md.
 */
export function assertAlmaId(id: string, type?: AlmaSubjectType): string {
  if (!isAlmaId(id, type)) {
    throw new ProblemError(400, "invalid_alma_id", "Invalid ALMA identifier", `Expected alma:main:${type ?? "<type>"}:<local-id>`);
  }
  return id;
}
