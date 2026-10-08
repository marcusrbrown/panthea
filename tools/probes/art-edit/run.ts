import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../..");
const runtime =
  "/Users/mrbrown/src/github.com/marcusrbrown/panthea/tools/probes/art-local-2";
const scratch = resolve(repo, ".context/studio-pipeline/art-edit");
const [label, ...args] = Bun.argv.slice(2);

if (!label || args.length === 0) {
  console.error(
    "Usage: bun tools/probes/art-edit/run.ts <label> -- <sd-cli arguments>",
  );
  process.exit(2);
}
const cliArgs = args[0] === "--" ? args.slice(1) : args;
const outputIndex = cliArgs.findIndex(
  (arg) => arg === "-o" || arg === "--output",
);
const output =
  outputIndex >= 0 ? resolve(runtime, cliArgs[outputIndex + 1]!) : undefined;
const started = new Date();
const t0 = performance.now();
await mkdir(resolve(scratch, "logs"), { recursive: true });
const logPath = resolve(
  scratch,
  "logs",
  `${label}-${started.toISOString().replaceAll(":", "-")}.log`,
);
const command = [resolve(runtime, "bin/release/sd-cli"), ...cliArgs];
const child = Bun.spawn(command, {
  cwd: runtime,
  stdout: "pipe",
  stderr: "pipe",
});
const timeout = setTimeout(() => child.kill("SIGTERM"), 30 * 60 * 1000);
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
clearTimeout(timeout);
const elapsedMs = Math.round(performance.now() - t0);
const text = `COMMAND: ${JSON.stringify(command)}\nEXIT: ${exitCode}\nWALL_MS: ${elapsedMs}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`;
await writeFile(logPath, text);
let outputSha256: string | null = null;
if (output) {
  try {
    outputSha256 = createHash("sha256")
      .update(Buffer.from(await Bun.file(output).arrayBuffer()))
      .digest("hex");
  } catch {}
}
const record = {
  label,
  command,
  startedAt: started.toISOString(),
  elapsedMs,
  seed: valueAfter(cliArgs, ["-s", "--seed"]),
  strength: valueAfter(cliArgs, ["--strength"]),
  output: output ?? null,
  outputSha256,
  exitCode,
  errored: exitCode !== 0 || outputSha256 === null,
  log: logPath,
};
await appendFile(resolve(scratch, "runs.jsonl"), `${JSON.stringify(record)}\n`);
console.log(JSON.stringify(record));
if (exitCode !== 0) process.exitCode = exitCode;

function valueAfter(values: string[], names: string[]) {
  const index = values.findIndex((arg) => names.includes(arg));
  return index >= 0 ? (values[index + 1] ?? null) : null;
}
