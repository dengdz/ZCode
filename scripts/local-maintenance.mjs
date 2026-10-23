#!/usr/bin/env node
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { build } from "./local-maintenance/build.mjs";
import { check, safeOutput } from "./local-maintenance/checks.mjs";
import { git, fail } from "./local-maintenance/process.mjs";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help") {
    console.log("local:maintain check|build --fork owner/repo --review FILE --output DIR");
    return;
  }
  if (!["check", "build"].includes(command)) fail("arguments");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !["--fork", "--review", "--output"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--") ||
      options[key]
    )
      fail("arguments");
    options[key] = args[i + 1];
  }
  const fork = options["--fork"];
  if (!/^[\w-]+\/[\w.-]+$/.test(fork ?? "") || fork.toLowerCase() === "zai-org/zcode")
    fail("fork-required");
  const origin = await git("remote", "get-url", "--all", "origin");
  if (origin !== `https://github.com/${fork}.git`) fail("remote-policy");
  if (await git("status", "--porcelain=v1", "--untracked-files=all")) fail("source-not-clean");
  let lock;
  if (command === "build") {
    lock = await git("rev-parse", "--git-path", "local-maintenance.lock");
    try {
      await mkdir(lock);
    } catch (e) {
      if (e.code === "EEXIST") fail("build-occupied");
      throw e;
    }
  }
  try {
    const report = await check(fork, options["--review"]);
    const output = await safeOutput(options["--output"]);
    await mkdir(output, { mode: 0o700 });
    await writeFile(join(output, "check.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(JSON.stringify({ status: report.buildAllowed ? "checked" : "blocked", output }));
    if (!report.buildAllowed) process.exitCode = 1;
    else if (command === "build") await build(report, output);
  } finally {
    if (lock) await rm(lock, { recursive: true });
  }
}
await main().catch((e) => {
  console.error(
    JSON.stringify({ status: "blocked", reason: e.maintenanceCode ?? "maintenance-failed" }),
  );
  process.exitCode = 1;
});
