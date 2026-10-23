#!/usr/bin/env node
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { backupCommand } from "./local-maintenance/backup.mjs";
import { build } from "./local-maintenance/build.mjs";
import { check, safeOutput } from "./local-maintenance/checks.mjs";
import { recoveryCommand } from "./local-maintenance/recovery.mjs";
import { installCommand } from "./local-maintenance/install.mjs";
import { git, fail } from "./local-maintenance/process.mjs";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help") {
    console.log(
      "local:maintain check|build --fork owner/repo --review FILE --output DIR\nlocal:maintain backup --home HOME --data-root ROOT --local-app APP --official-app APP --app-manifest FILE --backup-root DIR\nlocal:maintain backup-list --backup-root DIR\nlocal:maintain backup-verify --backup-root DIR --id ID\nlocal:maintain install --candidate FILE --current-manifest FILE --home HOME --data-root ROOT --local-app APP --official-app APP --backup-root DIR\nlocal:maintain rollback-plan|restore-plan --id BACKUP --current-manifest FILE --home HOME --data-root ROOT --local-app APP --official-app APP --backup-root DIR\nlocal:maintain rollback --backup-root DIR --plan recovery-UUID --compatibility FILE\nlocal:maintain restore --backup-root DIR --plan recovery-UUID --confirm SHA256",
    );
    return;
  }
  const recoverySourceOptions = [
    "--id",
    "--current-manifest",
    "--home",
    "--data-root",
    "--local-app",
    "--official-app",
    "--backup-root",
  ];
  const recoveryOptions = {
    "rollback-plan": recoverySourceOptions,
    "restore-plan": recoverySourceOptions,
    rollback: ["--backup-root", "--plan", "--compatibility"],
    restore: ["--backup-root", "--plan", "--confirm"],
  };
  const backupOptions = {
    ...recoveryOptions,
    backup: [
      "--home",
      "--data-root",
      "--local-app",
      "--official-app",
      "--app-manifest",
      "--backup-root",
    ],
    "backup-list": ["--backup-root"],
    "backup-verify": ["--backup-root", "--id"],
    install: [
      "--candidate",
      "--current-manifest",
      "--home",
      "--data-root",
      "--local-app",
      "--official-app",
      "--backup-root",
    ],
  };
  const allowed = backupOptions[command] ?? ["--fork", "--review", "--output"];
  if (!["check", "build", ...Object.keys(backupOptions)].includes(command)) fail("arguments");
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.includes(key) || !args[i + 1] || args[i + 1].startsWith("--") || options[key])
      fail("arguments");
    options[key] = args[i + 1];
  }
  if (backupOptions[command]) {
    if (allowed.some((key) => !options[key])) fail("arguments");
    if (recoveryOptions[command]) {
      console.log(JSON.stringify(await recoveryCommand(command, options)));
      return;
    }
    if (command === "install") {
      console.log(JSON.stringify(await installCommand(options)));
      return;
    }
    console.log(JSON.stringify(await backupCommand(command, options)));
    return;
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
