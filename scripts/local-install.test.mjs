import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  installFixture,
  launchLocal,
  waitForObserved,
  waitForGone,
} from "./test/local-install-fixture.mjs";

test("install switches only after the current app exits and preserves a verified backup", async (t) => {
  const f = await installFixture(t);
  const backupRoot = join(f.home, ".local/share/zcode-local/backups");
  await mkdir(join(f.home, ".local/share/zcode-local"), { recursive: true, mode: 0o700 });
  const args = [...f.args];
  args[args.indexOf("--backup-root") + 1] = backupRoot;
  const currentLaunch = launchLocal(f);
  let oldApp;
  try {
    oldApp = await waitForObserved(f.home, f.current.source.version);
  } catch (error) {
    const result = await currentLaunch.done;
    throw new Error(`${error.message}\nlauncher exit=${result.code}\n${result.output}`);
  }
  try {
    const installed = await f.run("install", ...args);
    assert.equal(installed.code, 0, installed.stderr);

    const currentLaunchResult = await currentLaunch.done;
    assert.equal(currentLaunchResult.code, 0, currentLaunchResult.output);
    const newApp = await waitForObserved(f.home, f.candidate.source.version);
    assert.notEqual(newApp.pid, oldApp.pid);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      "3.16.2-local.2",
    );

    const listed = await f.run("backup-list", "--backup-root", backupRoot);
    assert.equal(listed.code, 0, listed.stderr);
    const [backup] = JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable");
    assert.equal(backup.source.version, f.current.source.version);
    assert.equal(
      await readFile(join(backupRoot, backup.id, "payload/data/.zcode/v2/history.json"), "utf8"),
      "synthetic task history",
    );
    await assert.rejects(
      readFile(join(backupRoot, backup.id, "payload/data/.zcode/local/maintenance/runtime.json")),
      { code: "ENOENT" },
    );

    const switches = (await readdir(backupRoot)).filter((name) => name.startsWith("switch-"));
    assert.equal(switches.length, 1);
    const result = JSON.parse(await readFile(join(backupRoot, switches[0], "switch.json"), "utf8"));
    assert.equal(result.status, "ready");
    assert.equal(result.backupId, backup.id);
    assert.equal(result.from.version, f.current.source.version);
    assert.equal(result.to.version, f.candidate.source.version);
  } finally {
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit").catch(() => {});
    await waitForGone(join(f.data, ".zcode/local/launch-owner.json")).catch(() => {});
    if (currentLaunch.child.exitCode === null) currentLaunch.child.kill("SIGTERM");
  }
});

test("install can proceed when Local is already normally stopped", async (t) => {
  const f = await installFixture(t);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 0, installed.stderr);
    await waitForObserved(f.home, f.candidate.source.version);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.candidate.source.version,
    );
    const listed = await f.run("backup-list", "--backup-root", join(f.root, "backups"));
    assert.equal(
      JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable").length,
      1,
    );
  } finally {
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
    await waitForGone(join(f.data, ".zcode/local/launch-owner.json")).catch(() => {});
  }
});

test("concurrent installs serialize behind one switch gate", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-runtime-state"), "late-idle");
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const [left, right] = await Promise.all([
      f.run("install", ...f.args),
      f.run("install", ...f.args),
    ]);
    const results = [left, right];
    assert.deepEqual(results.map((result) => result.code).sort(), [0, 1]);
    const rejected = results.find((result) => result.code !== 0);
    assert.match(rejected.stderr, /install-unknown/);
    await waitForObserved(f.home, f.candidate.source.version);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.candidate.source.version,
    );
    const listed = await f.run("backup-list", "--backup-root", join(f.root, "backups"));
    assert.equal(
      JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable").length,
      1,
    );
    assert.equal(
      (await readdir(join(f.root, "backups"))).filter((name) => name.startsWith("switch-")).length,
      1,
    );
  } finally {
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
    await waitForGone(join(f.data, ".zcode/local/launch-owner.json")).catch(() => {});
    await launch.done;
  }
});

test("a stopped pre-protocol Local can be upgraded", async (t) => {
  const f = await installFixture(t, { currentProtocol: null });
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 0, installed.stderr);
    await waitForObserved(f.home, f.candidate.source.version);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.candidate.source.version,
    );
  } finally {
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
    await waitForGone(join(f.data, ".zcode/local/launch-owner.json")).catch(() => {});
  }
});

test("install rejects a takeover whose home and data roots disagree on ownership", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-corrupt-home-owner"), "yes");
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-startup-unconfirmed/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.candidate.source.version,
    );
    const listed = await f.run("backup-list", "--backup-root", join(f.root, "backups"));
    assert.equal(
      JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable").length,
      1,
    );
    assert.ok(
      (await readdir(f.applications)).some((name) => name.startsWith(".ZCode Local.previous-")),
    );
  } finally {
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
    await launch.done;
  }
});

for (const state of ["busy", "unknown"]) {
  test(`install stops before exit and replacement when the runtime reports ${state}`, async (t) => {
    const f = await installFixture(t);
    await writeFile(join(f.home, "fixture-runtime-state"), state);
    const launch = launchLocal(f);
    await waitForObserved(f.home, f.current.source.version);
    try {
      const installed = await f.run("install", ...f.args);
      assert.equal(installed.code, 1, installed.stderr);
      assert.match(installed.stderr, new RegExp(`install-${state}`));
      assert.equal(
        await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
        f.current.source.version,
      );
      await assert.rejects(readdir(join(f.root, "backups")));
      const owner = JSON.parse(
        await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
      );
      assert.equal(owner.phase, "running");
      assert.doesNotThrow(() => process.kill(owner.childPid, 0));
      await assert.rejects(readFile(join(f.data, ".zcode/local/maintenance/switch-request.json")), {
        code: "ENOENT",
      });
      assert.deepEqual(
        (await readdir(f.applications)).filter((name) => name.startsWith(".ZCode Local.staging-")),
        [],
      );
    } finally {
      await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
      assert.equal((await launch.done).code, 0);
    }
  });
}

test("install does not replace the app when the current application backup is invalid", async (t) => {
  const f = await installFixture(t);
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  await writeFile(
    join(f.data, ".zcode/v2/tasks-index.sqlite"),
    Buffer.from("corrupted database header"),
  );
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /backup-database-invalid|command-failed:sqlite3/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    const listed = await f.run("backup-list", "--backup-root", join(f.root, "backups"));
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(
      JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable").length,
      0,
    );
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await launch.done;
  }
});

test("install rejects an equal candidate before requesting the current app to exit", async (t) => {
  const f = await installFixture(t);
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  const equalArgs = [...f.args];
  equalArgs[equalArgs.indexOf("--candidate") + 1] = join(f.currentOutput, "candidate.json");
  try {
    const installed = await f.run("install", ...equalArgs);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-version-not-newer/);
    const owner = JSON.parse(
      await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
    );
    assert.equal(owner.phase, "running");
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await launch.done;
  }
});

test("a running pre-protocol app must be fully quit before installing", async (t) => {
  const f = await installFixture(t, { currentProtocol: null });
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /current-app-quit-required/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    const owner = JSON.parse(
      await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
    );
    assert.doesNotThrow(() => process.kill(owner.childPid, 0));
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await launch.done;
  }
});

test("install rejects a candidate without the maintenance protocol", async (t) => {
  const f = await installFixture(t, { candidateProtocol: null });
  const installed = await f.run("install", ...f.args);
  assert.equal(installed.code, 1, installed.stderr);
  assert.match(installed.stderr, /maintenance-protocol-unsupported/);
  assert.equal(
    await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
    f.current.source.version,
  );
  await assert.rejects(readdir(join(f.root, "backups")));
});

test("an absent exit acknowledgment never counts as a clean shutdown", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-runtime-state"), "silent");
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-unknown/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    const owner = JSON.parse(
      await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
    );
    assert.doesNotThrow(() => process.kill(owner.childPid, 0));
    await assert.rejects(readFile(join(f.data, ".zcode/local/maintenance/switch-request.json")), {
      code: "ENOENT",
    });
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await launch.done;
  }
});

test("a task that appears after idle keeps the app and releases the retry gate", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-runtime-state"), "idle-then-busy");
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-busy/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    const owner = JSON.parse(
      await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
    );
    assert.equal(owner.phase, "running");
    assert.doesNotThrow(() => process.kill(owner.childPid, 0));
    const maintenance = join(f.data, ".zcode/local/maintenance");
    await assert.rejects(readFile(join(maintenance, "switch-request.json")), {
      code: "ENOENT",
    });
    await assert.rejects(readFile(join(maintenance, "switch-commit.json")), {
      code: "ENOENT",
    });
    assert.equal((await readdir(maintenance)).includes("switch-gate"), false);
    await assert.rejects(readdir(join(f.root, "backups")));

    await writeFile(join(f.home, "fixture-runtime-state"), "idle");
    const retried = await f.run("install", ...f.args);
    assert.equal(retried.code, 0, retried.stderr);
    await waitForObserved(f.home, f.candidate.source.version);
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
    await waitForGone(join(f.data, ".zcode/local/launch-owner.json")).catch(() => {});
    await launch.done;
  }
});

test("a late idle response cannot quit the app after the request timed out", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-runtime-state"), "late-idle");
  f.env.ZCODE_MAINTENANCE_REQUEST_TIMEOUT_MS = "100";
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-unknown/);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const owner = JSON.parse(
      await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
    );
    assert.equal(owner.phase, "running");
    assert.doesNotThrow(() => process.kill(owner.childPid, 0));
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await launch.done;
  }
});

test("an unclean application exit keeps launch ownership and does not replace Local", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-runtime-state"), "failed-exit");
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-exit-unconfirmed/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    const owner = JSON.parse(
      await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
    );
    assert.equal(owner.phase, "unconfirmed");
    assert.equal((await launch.done).code, 1);
    await assert.rejects(readdir(join(f.root, "backups")));
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit").catch(() => {});
    if (launch.child.exitCode === null) launch.child.kill("SIGTERM");
  }
});

test("install rejects overlapping Local and official application identities", async (t) => {
  const f = await installFixture(t);
  const overlappingArgs = [...f.args];
  overlappingArgs[overlappingArgs.indexOf("--official-app") + 1] = f.localApp;
  const installed = await f.run("install", ...overlappingArgs);
  assert.equal(installed.code, 1, installed.stderr);
  assert.match(installed.stderr, /official-application-overlap/);
  await assert.rejects(readdir(join(f.root, "backups")));
});

test("install rejects a candidate whose symlinked application resolves inside the official app", async (t) => {
  const f = await installFixture(t);
  const alias = join(f.root, "candidate-alias");
  await symlink(f.candidateOutput, alias, "dir");
  const overlappingArgs = [...f.args];
  overlappingArgs[overlappingArgs.indexOf("--candidate") + 1] = join(alias, "candidate.json");
  overlappingArgs[overlappingArgs.indexOf("--official-app") + 1] = f.candidateOutput;
  try {
    const installed = await f.run("install", ...overlappingArgs);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-path-overlap/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    await assert.rejects(readdir(join(f.root, "backups")));
  } finally {
    await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit").catch(() => {});
  }
});

test("install revalidates candidate content instead of trusting ready manifest text", async (t) => {
  const f = await installFixture(t);
  await writeFile(
    join(f.candidateOutput, f.candidate.app, "Contents/Resources/fixture-version"),
    "tampered",
  );
  const installed = await f.run("install", ...f.args);
  assert.equal(installed.code, 1, installed.stderr);
  assert.match(installed.stderr, /candidate-application-mismatch/);
  assert.equal(
    await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
    f.current.source.version,
  );
  await assert.rejects(readdir(join(f.root, "backups")));
});

test("startup failure keeps the new target, previous app and verified backup as evidence", async (t) => {
  const f = await installFixture(t);
  await writeFile(join(f.home, "fixture-new-app-fail"), "exit");
  f.env.ZCODE_MAINTENANCE_STARTUP_TIMEOUT_MS = "750";
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-startup-unconfirmed/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.candidate.source.version,
    );
    const listed = await f.run("backup-list", "--backup-root", join(f.root, "backups"));
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(
      JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable").length,
      1,
    );
    const previous = (await readdir(f.applications)).find((name) =>
      name.startsWith(".ZCode Local.previous-"),
    );
    assert.ok(previous);
    assert.equal(
      await readFile(join(f.applications, previous, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit").catch(() => {});
    await launch.done;
  }
});

test("a failed rollback keeps switching ownership and both application copies", async (t) => {
  const f = await installFixture(t);
  const preload = join(f.root, "fail-target-rollback.mjs");
  await writeFile(
    preload,
    `import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
const rename = fsPromises.rename;
let failTargetRestore = false;
fsPromises.rename = async (source, target) => {
  if (String(source).includes(".ZCode Local.staging-") && String(target).endsWith("/ZCode Local.app")) {
    failTargetRestore = true;
    return Promise.reject(Object.assign(new Error("injected target failure"), { code: "EACCES" }));
  }
  if (failTargetRestore && String(source).includes(".ZCode Local.previous-") && String(target).endsWith("/ZCode Local.app"))
    return Promise.reject(Object.assign(new Error("injected restore failure"), { code: "EACCES" }));
  return rename(source, target);
};
syncBuiltinESMExports();
`,
  );
  f.env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
  const installed = await f.run("install", ...f.args);
  assert.equal(installed.code, 1, installed.stderr);
  assert.match(installed.stderr, /install-rollback-unconfirmed/);
  const owner = JSON.parse(await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"));
  assert.equal(owner.phase, "switching");
  await assert.rejects(readFile(join(f.localApp, "Contents/Resources/fixture-version")), {
    code: "ENOENT",
  });
  assert.ok(
    (await readdir(f.applications)).some((name) => name.startsWith(".ZCode Local.previous-")),
  );
  assert.ok(
    (await readdir(f.applications)).some((name) => name.startsWith(".ZCode Local.staging-")),
  );
});

test("a takeover launcher failure before app start restores the old target", async (t) => {
  const f = await installFixture(t);
  const launch = launchLocal(f);
  await waitForObserved(f.home, f.current.source.version);
  const preload = join(f.root, "fail-takeover-launcher.mjs");
  await writeFile(
    preload,
    `import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const [command, commandArgs, options] = args;
  if (
    String(command).endsWith("/node") &&
    Array.isArray(commandArgs) &&
    commandArgs.some((arg) => String(arg).endsWith("scripts/local-launch.ts")) &&
    commandArgs.includes("--takeover-token")
  )
    return spawn(process.execPath, ["-e", "process.exit(19)"], options);
  return spawn(...args);
};
syncBuiltinESMExports();
`,
  );
  f.env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
  f.env.ZCODE_MAINTENANCE_STARTUP_TIMEOUT_MS = "750";
  try {
    const installed = await f.run("install", ...f.args);
    assert.equal(installed.code, 1, installed.stderr);
    assert.match(installed.stderr, /install-startup-unconfirmed/);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      f.current.source.version,
    );
    assert.equal(
      (await readdir(f.applications)).some((name) => name.startsWith(".ZCode Local.previous-")),
      false,
    );
    const listed = await f.run("backup-list", "--backup-root", join(f.root, "backups"));
    assert.equal(
      JSON.parse(listed.stdout).backups.filter((item) => item.status === "usable").length,
      1,
    );
    await assert.rejects(readFile(join(f.data, ".zcode/local/launch-owner.json")), {
      code: "ENOENT",
    });
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit").catch(() => {});
    await launch.done;
  }
});
