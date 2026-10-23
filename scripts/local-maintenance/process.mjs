import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { resolveSpawnRuntimeOptions, quoteArgsForWindowsShell } from "../spawn-command.mjs";

export function fail(code) {
  throw Object.assign(new Error(code), { maintenanceCode: code });
}
export async function run(
  command,
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    log,
    hashStdout = false,
    includeStderr = false,
    input,
  } = {},
) {
  const runtime = resolveSpawnRuntimeOptions(command);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, runtime.shell ? quoteArgsForWindowsShell(args) : args, {
      cwd,
      env,
      ...runtime,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (input !== undefined) {
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
    const output = [];
    const errors = [];
    let size = 0;
    const hash = createHash("sha256");
    const collect = (list) => (chunk) => {
      size += chunk.length;
      if (size > 128 * 1024 * 1024) child.kill();
      else list.push(chunk);
    };
    child.stdout.on("data", hashStdout ? (chunk) => hash.update(chunk) : collect(output));
    child.stderr.on("data", collect(errors));
    child.once("error", reject);
    child.once("close", (code, signal) =>
      resolve({
        code,
        signal,
        stdout: hashStdout ? hash.digest("hex") : Buffer.concat(output).toString(),
        stderr: Buffer.concat(errors).toString(),
      }),
    );
  });
  if (log) await appendFile(log, result.stdout + result.stderr, { mode: 0o600 });
  if (result.code !== 0 || result.signal) fail(`command-failed:${command}`);
  return (result.stdout + (includeStderr ? result.stderr : "")).trim();
}
export const git = (...args) => run("git", args);
