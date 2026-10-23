import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkedFixture, buildTools } from "./local-maintenance-fixture.mjs";

const repo = process.cwd();

export function fixtureApplicationScript() {
  return `#!${process.execPath}
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const home = process.env.HOME;
const dataRoot = process.env.ZCODE_DATA_BASE_DIR;
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const version = readFileSync(join(appRoot, "Contents/Resources/fixture-version"), "utf8");
const token = process.env.ZCODE_LOCAL_LAUNCH_TOKEN;
const maintenance = join(dataRoot, ".zcode/local/maintenance");
mkdirSync(maintenance, { recursive: true, mode: 0o700 });
writeFileSync(join(home, "observed-" + version + ".json"), JSON.stringify({ pid: process.pid, version, token }));
if (token) {
  let failStartup = false;
  try {
    failStartup =
      version.endsWith("-local.2") &&
      readFileSync(join(home, "fixture-new-app-fail"), "utf8") === "exit";
  } catch {}
  if (failStartup) process.exit(1);
  let corruptHomeOwner = false;
  try {
    corruptHomeOwner =
      version.endsWith("-local.2") &&
      readFileSync(join(home, "fixture-corrupt-home-owner"), "utf8") === "yes";
  } catch {}
  if (corruptHomeOwner) {
    const deadline = Date.now() + 3000;
    let ownersReady = false;
    while (Date.now() < deadline) {
      try {
        const dataOwner = JSON.parse(readFileSync(join(dataRoot, ".zcode/local/launch-owner.json"), "utf8"));
        const homeOwner = JSON.parse(readFileSync(join(home, ".zcode/local/launch-owner.json"), "utf8"));
        if (
          dataOwner.phase === "running" &&
          homeOwner.phase === "running" &&
          dataOwner.token === token &&
          homeOwner.token === token
        ) {
          ownersReady = true;
          break;
        }
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
    if (!ownersReady) process.exit(1);
    const ownerPath = join(home, ".zcode/local/launch-owner.json");
    const owner = JSON.parse(readFileSync(ownerPath, "utf8"));
    owner.token = "conflicting-home-owner";
    writeFileSync(ownerPath, JSON.stringify(owner));
  }
  writeFileSync(join(maintenance, "runtime.json"), JSON.stringify({
      schema: 1,
      kind: "local-maintenance-runtime",
      token,
      appPid: process.pid,
      version,
      state: "ready",
      updatedAt: new Date().toISOString(),
    }));
}
process.on("SIGUSR2", () => {
  const request = JSON.parse(readFileSync(join(maintenance, "switch-request.json"), "utf8"));
  const state = readFileSync(join(home, "fixture-runtime-state"), "utf8").trim();
  if (state === "silent") return;
  let committed = false;
  try {
    const commit = JSON.parse(readFileSync(join(maintenance, "switch-commit.json"), "utf8"));
    committed =
      commit.requestId === request.requestId &&
      commit.token === request.token &&
      commit.appPid === process.pid;
  } catch {}
  if (state === "late-idle" && !committed) {
    setTimeout(() => {
      writeFileSync(join(maintenance, "switch-response.json"), JSON.stringify({
        schema: 1,
        kind: "local-maintenance-response",
        requestId: request.requestId,
        token: request.token,
        appPid: process.pid,
        status: "idle",
        runningTaskCount: 0,
        createdAt: new Date().toISOString(),
      }));
    }, 800);
    return;
  }
  let status = state === "busy" || (state === "idle-then-busy" && committed)
    ? "busy"
    : state === "unknown"
      ? "unknown"
      : "idle";
  if (status === "idle" && committed) status = "accepted";
  writeFileSync(join(maintenance, "switch-response.json"), JSON.stringify({
    schema: 1,
    kind: "local-maintenance-response",
    requestId: request.requestId,
    token: request.token,
    appPid: process.pid,
    status,
    runningTaskCount: status === "busy" ? 1 : status === "unknown" ? null : 0,
    createdAt: new Date().toISOString(),
  }));
  if (status === "accepted") process.exit(state === "failed-exit" ? 1 : 0);
});
setInterval(() => {
  try {
    readFileSync(join(home, "release-" + version));
    process.exit(0);
  } catch {}
}, 25);
`;
}

export async function waitForFile(path, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path}`);
}

export async function waitForObserved(home, version, timeout = 8000) {
  return JSON.parse(await waitForFile(join(home, `observed-${version}.json`), timeout));
}

export async function waitForGone(path, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${path} to disappear`);
}

async function buildVersion(f, output) {
  const built = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    output,
  );
  assert.equal(built.code, 0, built.stderr);
  return JSON.parse(await readFile(join(output, "candidate.json"), "utf8"));
}

export async function installFixture(t, { currentProtocol = 1, candidateProtocol = 1 } = {}) {
  const f = await checkedFixture(t);
  const appEntry = fixtureApplicationScript();
  await buildTools(f, {
    appEntry,
    executableFixture: true,
    maintenanceProtocol: currentProtocol,
  });
  const currentOutput = join(f.root, "current-candidate");
  const current = await buildVersion(f, currentOutput);
  const applications = join(f.root, "Applications");
  await mkdir(applications);
  const localApp = join(applications, "ZCode Local.app");
  await cp(join(currentOutput, current.app), localApp, { recursive: true });

  await f.git("branch", "-m", "3.16.2-local.2");
  await writeFile(
    join(f.repo, "package.json"),
    JSON.stringify({ version: "3.16.2-local.2", packageManager: "pnpm@10.33.2" }),
  );
  await f.git("add", "package.json");
  await f.git("commit", "-m", "next local revision");
  await buildTools(f, {
    appEntry,
    executableFixture: true,
    maintenanceProtocol: candidateProtocol,
  });
  const candidateOutput = join(f.root, "next-candidate");
  const candidate = await buildVersion(f, candidateOutput);

  const home = join(f.root, "daily-home");
  const data = join(f.root, "daily-data");
  for (const root of [home, data]) {
    await mkdir(join(root, ".zcode/v2"), { recursive: true });
    await mkdir(join(root, ".zcode/local/v1"), { recursive: true });
  }
  await writeFile(join(home, ".zcode/v2/setting.json"), JSON.stringify({ dataBaseDir: data }));
  await writeFile(join(data, ".zcode/v2/history.json"), "synthetic task history");
  await writeFile(join(home, "fixture-runtime-state"), "idle");

  const args = [
    "--candidate",
    join(candidateOutput, "candidate.json"),
    "--current-manifest",
    join(currentOutput, "candidate.json"),
    "--home",
    home,
    "--data-root",
    data,
    "--local-app",
    localApp,
    "--official-app",
    join(applications, "ZCode.app"),
    "--backup-root",
    join(f.root, "backups"),
  ];
  return {
    ...f,
    appEntry,
    current,
    candidate,
    currentOutput,
    candidateOutput,
    localApp,
    applications,
    home,
    data,
    args,
  };
}

export function launchLocal(f) {
  const child = spawn(
    process.execPath,
    [
      join(repo, "node_modules/tsx/dist/cli.mjs"),
      join(repo, "scripts/local-launch.ts"),
      "--edition",
      "local",
      "--home",
      f.home,
      "--data-root",
      f.data,
      "--official-app",
      join(f.applications, "ZCode.app"),
      "--local-app",
      f.localApp,
      "--",
      "--hold",
    ],
    { cwd: repo, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const done = new Promise((resolve) => child.once("exit", (code) => resolve({ code, output })));
  return { child, done };
}
