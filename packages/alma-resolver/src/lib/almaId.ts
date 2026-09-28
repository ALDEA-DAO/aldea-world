import { AlmaValidationError, parseIdentifier } from "@adasouls/alma-core";
import { ALMA_NETWORK, type AlmaSubjectType } from "@aldea/shared/alma";
import { ProblemError } from "./problem";

// AlmaAnchorRegistry anchors a narrower profile than the ALMA spec: the `main` network, the literal segments
// `human`, `org` and `agent` (never `organization`), and `[a-z0-9-]{1,64}` local ids.
const REGISTRY_SEGMENTS: readonly AlmaSubjectType[] = ["human", "org", "agent"];
const REGISTRY_LOCAL_ID_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Validates an ALMA identifier with @adasouls/alma-core, then against the profile AlmaAnchorRegistry enforces
 * on-chain, so anything the Resolver accepts can be anchored.
 */
export function assertAlmaId(id: string, type?: AlmaSubjectType): string {
  const expected = `Expected alma:${ALMA_NETWORK}:${type ?? "<human|org|agent>"}:<local-id>`;
  let parsed;
  try {
    parsed = parseIdentifier(id);
  } catch (err) {
    if (err instanceof AlmaValidationError) throw new ProblemError(400, "invalid_alma_id", "Invalid ALMA identifier", `${err.message}. ${expected}`);
    throw err;
  }
  const segment = (parsed.subjectTypeSegment ?? parsed.subjectType) as AlmaSubjectType;
  if (
    parsed.network !== ALMA_NETWORK ||
    !REGISTRY_SEGMENTS.includes(segment) ||
    !REGISTRY_LOCAL_ID_RE.test(parsed.localId) ||
    (type !== undefined && segment !== type)
  ) {
    throw new ProblemError(400, "invalid_alma_id", "Invalid ALMA identifier", expected);
  }
  return id;
}
