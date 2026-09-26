import { PreparedQuery } from "@pgtyped/runtime";

/**
 * Builds a pgtyped PreparedQuery from SQL with `:name` (optional) and `:name!` (required) parameters, the input
 * `World.resolve` expects in an STF, without running pgtyped's codegen against a live database.
 */
export function sql<Params extends object = Record<string, unknown>, Result = Record<string, unknown>>(
  statement: string,
): PreparedQuery<Params, Result> {
  const params = new Map<string, { name: string; required: boolean; transform: { type: "scalar" }; locs: { a: number; b: number }[] }>();
  const re = /(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)(!?)/g;
  for (let m = re.exec(statement); m !== null; m = re.exec(statement)) {
    const name = m[1]!;
    const entry = params.get(name) ?? { name, required: false, transform: { type: "scalar" as const }, locs: [] };
    entry.required ||= m[2] === "!";
    // pgtyped locations are inclusive: b is the index of the placeholder's last character
    entry.locs.push({ a: m.index, b: m.index + m[0].length - 1 });
    params.set(name, entry);
  }
  const queryIR = {
    usedParamSet: Object.fromEntries([...params.keys()].map((k) => [k, true])),
    params: [...params.values()],
    statement,
  };
  return new PreparedQuery<Params, Result>(queryIR as any);
}
