import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { readFile, writeFile, readdir, mkdir, symlink, readlink, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { installFixture, waitForGone, waitForObserved } from "./test/local-install-fixture.mjs";

async function recoveryFixture(t, options) {
  const f = await installFixture(t, options);
  if (options?.prepare) await options.prepare(f);
  const installed = await f.run("install", ...f.args);
  assert.equal(installed.code, 0, installed.stderr);
  const result = JSON.parse(installed.stdout.trim().split("\n").at(-1));
  await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit");
  await waitForGone(join(f.data, ".zcode/local/launch-owner.json"));
  await writeFile(join(f.data, ".zcode/v2/history.json"), "new work after snapshot");
  const args = [
    "--id",
    result.backupId,
    "--current-manifest",
    join(f.candidateOutput, "candidate.json"),
    ...f.args.slice(f.args.indexOf("--home")),
  ];
  return { ...f, recoveryArgs: args, backupId: result.backupId, backups: join(f.root, "backups") };
}

test("restore preview shows snapshot losses and refuses missing confirmation without changing current work", async (t) => {
  const f = await recoveryFixture(t);
  const preview = await f.run("restore-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.status, "confirmation-required");
  assert.match(plan.snapshotTime, /^2026-/);
  assert.equal(plan.loss.modified, 1);
  assert.deepEqual(plan.loss.components, [
    { role: "home", added: 0, modified: 0, removed: 0 },
    { role: "data", added: 0, modified: 1, removed: 0 },
  ]);
  assert.match(plan.warning, /新增|丢失/);
  const denied = await f.run(
    "restore",
    "--backup-root",
    f.backups,
    "--plan",
    plan.id,
    "--confirm",
    "no",
  );
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /restore-confirmation-required/);
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    "new work after snapshot",
  );
});

test("confirmed restore keeps a verified current backup, restores old data, preserves control/profile and leaves the app stopped", async (t) => {
  const f = await recoveryFixture(t);
  await writeFile(join(f.home, ".zcode/local/profile-marker"), "keep live profile");
  await writeFile(join(f.data, ".zcode/local/v1/new-record.json"), "new local record");
  await writeFile(join(f.data, ".zcode/v2/new-task.json"), "only after snapshot");
  const preview = await f.run("restore-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  const restored = await f.run(
    "restore",
    "--backup-root",
    f.backups,
    "--plan",
    plan.id,
    "--confirm",
    plan.planSha256,
  );
  assert.equal(restored.code, 0, restored.stderr);
  const result = JSON.parse(restored.stdout.trim().split("\n").at(-1));
  assert.equal(result.status, "restored-stopped");
  await assert.rejects(readFile(join(f.data, ".zcode/local/v1/new-record.json")), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    "synthetic task history",
  );
  await assert.rejects(readFile(join(f.data, ".zcode/v2/new-task.json")), { code: "ENOENT" });
  assert.equal(
    await readFile(join(f.home, ".zcode/local/profile-marker"), "utf8"),
    "keep live profile",
  );
  assert.equal(
    await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
    "3.16.2-local.2",
  );
  assert.equal(
    await readFile(
      join(f.backups, result.currentBackupId, "payload/data/.zcode/v2/history.json"),
      "utf8",
    ),
    "new work after snapshot",
  );
  const verified = await f.run(
    "backup-verify",
    "--backup-root",
    f.backups,
    "--id",
    result.currentBackupId,
  );
  assert.equal(verified.code, 0, verified.stderr);
  await assert.rejects(readFile(join(f.data, ".zcode/local/launch-owner.json")), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(join(f.data, ".zcode/local/maintenance/switch-gate/gate.json")), {
    code: "ENOENT",
  });
});

async function reviewedRollback(f, plan, decision = "compatible") {
  const file = join(f.root, "compatibility.json");
  await writeFile(
    file,
    JSON.stringify({
      schema: 1,
      kind: "local-rollback-compatibility",
      planSha256: plan.planSha256,
      currentDataSha256: plan.currentDataSha256,
      from: plan.from,
      to: plan.to,
      decision,
      evidence:
        "Synthetic fixture both revisions read unchanged text files; isolated process seam only.",
    }),
  );
  return f.run("rollback", "--backup-root", f.backups, "--plan", plan.id, "--compatibility", file);
}

test("confirmed restore replaces plugin link objects and never restores or changes external content", async (t) => {
  const f = await recoveryFixture(t, {
    prepare: async (fixture) => {
      const base = join(fixture.home, ".zcode/cli/plugins/cache/vendor/plugin");
      await mkdir(base, { recursive: true });
      await writeFile(join(fixture.root, "external.txt"), "original external");
      await symlink(join(fixture.root, "external.txt"), join(base, "AGENTS.md"));
    },
  });
  const link = join(f.home, ".zcode/cli/plugins/cache/vendor/plugin/AGENTS.md");
  await writeFile(join(f.root, "external.txt"), "external changed independently");
  await rm(link);
  await symlink(join(f.root, "missing-new-target"), link);
  const preview = await f.run("restore-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.pluginResourceLinks.snapshot, 1);
  assert.equal(plan.pluginResourceLinks.current, 1);
  assert.match(plan.pluginResourceLinks.warning, /外部.*不.*保证/);
  assert.ok(!preview.stdout.includes("missing-new-target"));
  assert.equal(plan.loss.modified, 2);
  const restored = await f.run(
    "restore",
    "--backup-root",
    f.backups,
    "--plan",
    plan.id,
    "--confirm",
    plan.planSha256,
  );
  assert.equal(restored.code, 0, restored.stderr);
  assert.equal(await readlink(link), join(f.root, "external.txt"));
  assert.equal(
    await readFile(join(f.root, "external.txt"), "utf8"),
    "external changed independently",
  );
  const result = JSON.parse(restored.stdout.trim().split("\n").at(-1));
  assert.equal(
    await readlink(
      join(
        f.backups,
        result.currentBackupId,
        "payload/home/.zcode/cli/plugins/cache/vendor/plugin/AGENTS.md",
      ),
    ),
    join(f.root, "missing-new-target"),
  );
});

test("program rollback keeps current work and requires an exact compatible review", async (t) => {
  const f = await recoveryFixture(t);
  const preview = await f.run("rollback-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  const denied = await reviewedRollback(f, plan, "incompatible");
  assert.equal(denied.code, 1);
  assert.match(denied.stderr, /rollback-compatibility-unconfirmed/);
  await writeFile(join(f.home, `release-${f.candidate.source.version}`), "exit");
  try {
    const result = await reviewedRollback(f, plan);
    assert.equal(result.code, 0, result.stderr);
    const completed = JSON.parse(result.stdout.trim().split("\n").at(-1));
    assert.equal(completed.status, "rolled-back");
    assert.equal(completed.version, "3.16.2-local.1");
    await waitForObserved(f.home, f.current.source.version);
    assert.equal(
      await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
      "3.16.2-local.1",
    );
    assert.equal(
      await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
      "new work after snapshot",
    );
    const verify = await f.run(
      "backup-verify",
      "--backup-root",
      f.backups,
      "--id",
      completed.backupId,
    );
    assert.equal(verify.code, 0, verify.stderr);
  } finally {
    await writeFile(join(f.home, `release-${f.current.source.version}`), "exit");
    await waitForGone(join(f.data, ".zcode/local/launch-owner.json")).catch(() => {});
  }
});

for (const mode of ["restore", "rollback"]) {
  test(`${mode} refuses stale data and preserves current work`, async (t) => {
    const f = await recoveryFixture(t);
    const preview = await f.run(mode + "-plan", ...f.recoveryArgs);
    assert.equal(preview.code, 0, preview.stderr);
    const plan = JSON.parse(preview.stdout);
    await writeFile(join(f.data, ".zcode/v2/history.json"), "later work");
    const result =
      mode === "restore"
        ? await f.run(
            "restore",
            "--backup-root",
            f.backups,
            "--plan",
            plan.id,
            "--confirm",
            plan.planSha256,
          )
        : await reviewedRollback(f, plan);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /recovery-data-changed/);
    assert.equal(await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"), "later work");
    await assert.rejects(readFile(join(f.data, ".zcode/local/maintenance/switch-gate/gate.json")), {
      code: "ENOENT",
    });
  });
}

for (const fault of ["replace", "revert", "crash"]) {
  test(`restore ${fault} failure preserves recovery evidence and never reports success`, async (t) => {
    const f = await recoveryFixture(t);
    const preview = await f.run("restore-plan", ...f.recoveryArgs);
    assert.equal(preview.code, 0, preview.stderr);
    const plan = JSON.parse(preview.stdout);
    const preload = join(f.root, "restore-fault.mjs");
    await writeFile(
      preload,
      `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rename=fs.promises.rename;let triggered=false;
fs.promises.rename=async(from,to)=>{
 if(from.includes('/after/v2')&&!triggered){triggered=true;throw new Error('synthetic replacement failure');}
 if(${JSON.stringify(fault)}==='revert'&&from.includes('/before/v2'))throw new Error('synthetic revert failure');
 const result=await rename(from,to);
 if(${JSON.stringify(fault)}==='crash'&&to.includes('/before/v2'))process.exit(23);
 return result;
};syncBuiltinESMExports();`,
    );
    f.env.NODE_OPTIONS = "--import=" + pathToFileURL(preload).href;
    const result = await f.run(
      "restore",
      "--backup-root",
      f.backups,
      "--plan",
      plan.id,
      "--confirm",
      plan.planSha256,
    );
    delete f.env.NODE_OPTIONS;
    assert.notEqual(result.code, 0);
    const journal = JSON.parse(await readFile(join(f.backups, plan.id, "journal.json"), "utf8"));
    assert.ok(journal.currentBackupId);
    assert.equal(
      await readFile(
        join(f.backups, journal.currentBackupId, "payload/data/.zcode/v2/history.json"),
        "utf8",
      ),
      "new work after snapshot",
    );
    const verified = await f.run(
      "backup-verify",
      "--backup-root",
      f.backups,
      "--id",
      journal.currentBackupId,
    );
    assert.equal(verified.code, 0, verified.stderr);
    if (fault === "replace") {
      assert.equal(journal.phase, "failed-current-preserved");
      assert.equal(
        await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
        "new work after snapshot",
      );
      await assert.rejects(readFile(join(f.data, ".zcode/local/launch-owner.json")), {
        code: "ENOENT",
      });
    } else {
      const owner = JSON.parse(
        await readFile(join(f.data, ".zcode/local/launch-owner.json"), "utf8"),
      );
      assert.equal(owner.phase, "switching");
      assert.ok(await readFile(join(f.data, ".zcode/local/maintenance/switch-gate/gate.json")));
      const next = await f.run("restore-plan", ...f.recoveryArgs);
      assert.equal(next.code, 1);
      assert.match(next.stderr, /recovery-(unconfirmed|data-root-mismatch)/);
    }
  });
}

test("pinned recovery snapshot survives later backup retention", async (t) => {
  const f = await recoveryFixture(t);
  const preview = await f.run("restore-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  for (let index = 0; index < 3; index++) {
    const backup = await f.run(
      "backup",
      "--app-manifest",
      join(f.candidateOutput, "candidate.json"),
      ...f.args.slice(f.args.indexOf("--home")),
    );
    assert.equal(backup.code, 0, backup.stderr);
  }
  const restored = await f.run(
    "restore",
    "--backup-root",
    f.backups,
    "--plan",
    plan.id,
    "--confirm",
    plan.planSha256,
  );
  assert.equal(restored.code, 0, restored.stderr);
  const currentBackupId = JSON.parse(restored.stdout.trim().split("\n").at(-1)).currentBackupId;
  const immediate = await f.run("backup-list", "--backup-root", f.backups);
  assert.equal(
    JSON.parse(immediate.stdout).backups.filter((item) => item.status === "usable").length,
    5,
  );

  for (let index = 0; index < 4; index++) {
    const result = await f.run(
      "backup",
      "--app-manifest",
      join(f.candidateOutput, "candidate.json"),
      ...f.args.slice(f.args.indexOf("--home")),
    );
    assert.equal(result.code, 0, result.stderr);
  }
  const listing = await f.run("backup-list", "--backup-root", f.backups);
  const backups = JSON.parse(listing.stdout).backups.filter((item) => item.status === "usable");
  assert.equal(backups.length, 5);
  assert.ok(backups.some((item) => item.id === currentBackupId));
  assert.ok(backups.some((item) => item.id === f.backupId));
  assert.equal((await readdir(f.backups)).filter((name) => name.startsWith("recovery-")).length, 1);
});

test("compatible pre-protocol program rollback preserves current data and stays stopped", async (t) => {
  const f = await recoveryFixture(t, { currentProtocol: null });
  const preview = await f.run("rollback-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  const result = await reviewedRollback(f, plan);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout.trim().split("\n").at(-1)).status, "rolled-back-stopped");
  assert.equal(
    await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
    "3.16.2-local.1",
  );
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    "new work after snapshot",
  );
  await assert.rejects(readFile(join(f.home, `observed-${f.current.source.version}.json`)), {
    code: "ENOENT",
  });
  await assert.rejects(readFile(join(f.data, ".zcode/local/launch-owner.json")), {
    code: "ENOENT",
  });
});

test("snapshot, identity and unknown-owner checks refuse recovery before creating plans or changing work", async (t) => {
  const f = await recoveryFixture(t);
  const ownerPath = join(f.data, ".zcode/local/launch-owner.json");
  await writeFile(ownerPath, "unparseable owner");
  const occupied = await f.run("restore-plan", ...f.recoveryArgs);
  assert.equal(occupied.code, 1);
  assert.match(occupied.stderr, /recovery-unconfirmed/);
  // Use a second identity rather than clearing the unknown owner: no test endorses automatic stale-owner cleanup.
  const secondHome = join(f.root, "second-home");
  await mkdir(join(secondHome, ".zcode/v2"), { recursive: true });
  const otherArgs = [...f.recoveryArgs];
  otherArgs[otherArgs.indexOf("--home") + 1] = secondHome;
  otherArgs[otherArgs.indexOf("--data-root") + 1] = secondHome;
  const wrongIdentity = await f.run("restore-plan", ...otherArgs);
  assert.equal(wrongIdentity.code, 1);
  assert.match(wrongIdentity.stderr, /recovery-identity-mismatch/);
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    "new work after snapshot",
  );
  assert.equal((await readdir(f.backups)).filter((name) => name.startsWith("recovery-")).length, 0);
});

test("recovery rejects a snapshot changed after preview and a review for a different plan", async (t) => {
  const f = await recoveryFixture(t);
  const preview = await f.run("rollback-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  const stale = await reviewedRollback(f, { ...plan, planSha256: "0".repeat(64) });
  assert.equal(stale.code, 1);
  assert.match(stale.stderr, /rollback-compatibility-unconfirmed/);
  await writeFile(
    join(f.backups, f.backupId, "payload/data/.zcode/v2/history.json"),
    "tampered snapshot",
  );
  const changed = await reviewedRollback(f, plan);
  assert.equal(changed.code, 1);
  assert.match(changed.stderr, /backup-content-mismatch/);
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    "new work after snapshot",
  );
  assert.equal(
    await readFile(join(f.localApp, "Contents/Resources/fixture-version"), "utf8"),
    "3.16.2-local.2",
  );
});

test("restore recovers real clean-WAL SQLite and one-root home/data exactly once", async (t) => {
  const exec = promisify(execFile);
  const f = await recoveryFixture(t, {
    prepare: async (fixture) => {
      await writeFile(join(fixture.home, ".zcode/v2/history.json"), "synthetic task history");
      fixture.data = fixture.home;
      fixture.args[fixture.args.indexOf("--data-root") + 1] = fixture.home;
      await writeFile(
        join(fixture.home, ".zcode/v2/setting.json"),
        JSON.stringify({ dataBaseDir: fixture.home }),
      );
      await exec("sqlite3", [
        join(fixture.home, ".zcode/v2/tasks.sqlite"),
        "PRAGMA journal_mode=WAL; CREATE TABLE work(value TEXT); INSERT INTO work VALUES('snapshot');",
      ]);
    },
  });
  await exec("sqlite3", [
    join(f.data, ".zcode/v2/tasks.sqlite"),
    "INSERT INTO work VALUES('new work');",
  ]);
  const preview = await f.run("restore-plan", ...f.recoveryArgs);
  assert.equal(preview.code, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  const result = await f.run(
    "restore",
    "--backup-root",
    f.backups,
    "--plan",
    plan.id,
    "--confirm",
    plan.planSha256,
  );
  assert.equal(result.code, 0, result.stderr);
  const restored = JSON.parse(result.stdout.trim().split("\n").at(-1));
  assert.equal(
    (
      await exec("sqlite3", [
        join(f.data, ".zcode/v2/tasks.sqlite"),
        "SELECT group_concat(value, ',') FROM work;",
      ])
    ).stdout.trim(),
    "snapshot",
  );
  const current = JSON.parse(
    await readFile(join(f.backups, restored.currentBackupId, "backup.json"), "utf8"),
  );
  assert.deepEqual(
    current.components.map((part) => part.role),
    ["application", "home"],
  );
  assert.equal(
    (
      await exec("sqlite3", [
        join(f.backups, restored.currentBackupId, "payload/home/.zcode/v2/tasks.sqlite"),
        "SELECT group_concat(value, ',') FROM work;",
      ])
    ).stdout.trim(),
    "snapshot,new work",
  );
  const repeat = await f.run(
    "restore",
    "--backup-root",
    f.backups,
    "--plan",
    plan.id,
    "--confirm",
    plan.planSha256,
  );
  assert.equal(repeat.code, 1);
});
