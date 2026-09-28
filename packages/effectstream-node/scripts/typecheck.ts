/**
 * Type-checks this package's own files. @effectstream/* ships TypeScript sources that do not pass `tsc` on their own
 * (they target Bun without strict checking), and skipLibCheck does not apply to .ts sources, so errors reported
 * inside node_modules are ignored here and every error in src/, test/ or scripts/ fails the check.
 */
const proc = Bun.spawnSync(["pnpm", "exec", "tsc", "--noEmit", "--pretty", "false"], { stdout: "pipe", stderr: "pipe" });
const lines = `${proc.stdout.toString()}${proc.stderr.toString()}`.split("\n");
const own = lines.filter((l) => /^(src|test|scripts)\//.test(l));
for (const line of own) console.error(line);
const ignored = lines.filter((l) => l.includes("node_modules/") && l.includes("error TS")).length;
console.log(`${own.length} error(s) in effectstream-node; ${ignored} ignored inside @effectstream sources`);
process.exit(own.length > 0 ? 1 : 0);
