import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, symlink, cp } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkedFixture, buildTools } from "./test/local-maintenance-fixture.mjs";
const exec = promisify(execFile);
async function backupFixture(t) {
  const f = await checkedFixture(t);
  await buildTools(f);
  const built = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(built.code, 0, built.stderr);
  const candidate = JSON.parse(await readFile(join(f.output, "candidate.json"), "utf8"));
  const home = join(f.root, "backup-home"),
    data = join(f.root, "business-data");
  for (const root of [home, data]) {
    await mkdir(join(root, ".zcode/v2"), { recursive: true });
    await mkdir(join(root, ".zcode/local/v1"), { recursive: true });
  }
  await writeFile(join(home, ".zcode/v2/setting.json"), JSON.stringify({ dataBaseDir: data }));
  await writeFile(join(data, ".zcode/v2/history.json"), '[{"title":"retained work"}]');
  await writeFile(join(data, ".zcode/local/v1/collaboration.json"), '{"version":1,"fixture":true}');
  await mkdir(join(home, ".zcode/cli"));
  await writeFile(join(home, ".zcode/cli/config.json"), '{"fixture":true}');
  const backups = join(f.root, "backups");
  const args = [
    "--home",
    home,
    "--data-root",
    data,
    "--local-app",
    join(f.output, candidate.app),
    "--official-app",
    join(f.root, "absent-official.app"),
    "--app-manifest",
    join(f.output, "candidate.json"),
    "--backup-root",
    backups,
  ];
  return { ...f, home, data, backups, args };
}

test("backup creates and verifies a recoverable application, home, business and Local record baseline", async (t) => {
  const f = await backupFixture(t);
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 0, result.stderr);
  const listing = await f.run("backup-list", "--backup-root", f.backups);
  assert.equal(listing.code, 0, listing.stderr);
  const [backup] = JSON.parse(listing.stdout).backups;
  assert.equal(backup.status, "usable");
  assert.equal(backup.source.commit, await f.git("rev-parse", "HEAD"));
  assert.equal(backup.source.version, "3.16.2-local.1");
  const dir = join(f.backups, backup.id);
  assert.equal(
    await readFile(join(dir, "payload/data/.zcode/v2/history.json"), "utf8"),
    '[{"title":"retained work"}]',
  );
  assert.equal(
    await readFile(join(dir, "payload/data/.zcode/local/v1/collaboration.json"), "utf8"),
    '{"version":1,"fixture":true}',
  );
  assert.equal(
    await readFile(join(dir, "payload/home/.zcode/cli/config.json"), "utf8"),
    '{"fixture":true}',
  );
  const verification = await f.run("backup-verify", "--backup-root", f.backups, "--id", backup.id);
  assert.equal(verification.code, 0, verification.stderr);
  assert.equal(JSON.parse(verification.stdout).status, "usable");
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    '[{"title":"retained work"}]',
  );
});

test("retention keeps three usable baselines and never counts incomplete or corrupt groups", async (t) => {
  const f = await backupFixture(t);
  const ids = [];
  for (let i = 0; i < 5; i++) {
    await writeFile(join(f.data, ".zcode/v2/history.json"), JSON.stringify({ revision: i }));
    const result = await f.run("backup", ...f.args);
    assert.equal(result.code, 0, result.stderr);
    ids.push(JSON.parse(result.stdout).id);
    if (i === 0)
      await writeFile(join(f.backups, ids[0], "payload/data/.zcode/v2/history.json"), "corrupt");
    if (i === 1) {
      await mkdir(join(f.backups, "backup-00000000-0000-0000-0000-000000000000"), { mode: 0o700 });
      await writeFile(join(f.backups, "unrelated.txt"), "preserve");
    }
  }
  const result = await f.run("backup-list", "--backup-root", f.backups);
  const groups = JSON.parse(result.stdout).backups;
  assert.deepEqual(
    groups.filter((item) => item.status === "usable").map((item) => item.id),
    ids.slice(2).reverse(),
  );
  assert.equal(groups.filter((item) => item.status === "unusable").length, 2);
  await assert.rejects(readFile(join(f.backups, ids[1], "backup.json")));
  assert.equal(await readFile(join(f.backups, "unrelated.txt"), "utf8"), "preserve");
  assert.equal(await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"), '{"revision":4}');
});

test("backup rejects a manifest with a forged source anchor even when the application tree matches", async (t) => {
  const f = await backupFixture(t);
  const manifest = join(f.output, "candidate.json");
  const candidate = JSON.parse(await readFile(manifest, "utf8"));
  candidate.source.commit = "0".repeat(40);
  await writeFile(manifest, JSON.stringify(candidate));
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /package-source-mismatch/);
});

test("unsafe backup destination is rejected before it creates files inside the business data", async (t) => {
  const f = await backupFixture(t);
  const root = join(f.data, ".zcode/unsafe-backups");
  f.args[f.args.indexOf("--backup-root") + 1] = root;
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 1);
  await assert.rejects(readFile(join(root, "backup-root.json")));
});

for (const failure of [
  "no-space",
  "copy-full",
  "source-changed",
  "broken-database",
  "broken-header",
]) {
  test(`failed ${failure} backup preserves existing recovery baselines and source application`, async (t) => {
    const f = await backupFixture(t);
    const first = await f.run("backup", ...f.args);
    assert.equal(first.code, 0, first.stderr);
    const baseline = JSON.parse(first.stdout).id;
    if (["broken-database", "broken-header"].includes(failure)) {
      await writeFile(
        join(f.data, ".zcode/v2/tasks-index.sqlite"),
        failure === "broken-header"
          ? Buffer.from("corrupted database header")
          : Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(1000, 123)]),
      );
    } else {
      const preload = join(f.root, "fault.mjs");
      const fault =
        failure === "no-space"
          ? "fs.promises.statfs=async()=>({bavail:0n,bsize:4096n});"
          : failure === "copy-full"
            ? "fs.promises.cp=async()=>{throw Object.assign(new Error('full'),{code:'ENOSPC'})};"
            : `const copy=fs.promises.cp;fs.promises.cp=async(...args)=>{await copy(...args);if(args[0].endsWith("/business-data/.zcode"))await fs.promises.writeFile(${JSON.stringify(join(f.data, ".zcode/v2/history.json"))},'changed during copy');};`;
      await writeFile(
        preload,
        `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';${fault}syncBuiltinESMExports();`,
      );
      f.env.NODE_OPTIONS = "--import=" + pathToFileURL(preload).href;
    }
    const result = await f.run("backup", ...f.args);
    assert.equal(result.code, 1, result.stdout);
    if (failure === "no-space") assert.match(result.stderr, /backup-insufficient-space/);
    if (failure === "source-changed") assert.match(result.stderr, /backup-content-mismatch/);
    delete f.env.NODE_OPTIONS;
    const listing = await f.run("backup-list", "--backup-root", f.backups);
    assert.deepEqual(
      JSON.parse(listing.stdout)
        .backups.filter((item) => item.status === "usable")
        .map((item) => item.id),
      [baseline],
    );
    assert.equal(
      await readFile(
        join(f.output, "artifacts/mac-arm64/ZCode Local.app/Contents/MacOS/ZCode Local"),
        "utf8",
      ),
      "synthetic",
    );
  });
}

for (const state of ["running", "unconfirmed", "corrupt", "redirect", "external-link"]) {
  test(`backup rejects ${state} data without releasing launch ownership or changing source data`, async (t) => {
    const f = await backupFixture(t);
    const owner = join(f.data, ".zcode/local/launch-owner.json");
    if (["running", "unconfirmed"].includes(state))
      await writeFile(
        owner,
        JSON.stringify({
          version: 1,
          token: "fixture",
          edition: "local",
          launcherPid: process.pid,
          phase: state,
        }),
      );
    if (state === "corrupt") await writeFile(owner, "unconfirmed record");
    if (state === "redirect") f.args[f.args.indexOf("--data-root") + 1] = f.home;
    if (state === "external-link")
      await symlink(join(f.root, "outside"), join(f.data, ".zcode/v2/outside"));
    const result = await f.run("backup", ...f.args);
    assert.equal(result.code, 1, result.stdout);
    if (state === "redirect") assert.match(result.stderr, /backup-data-root-mismatch/);
    if (["running", "unconfirmed", "corrupt"].includes(state))
      assert.ok(await readFile(owner, "utf8"));
    assert.equal(
      await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
      '[{"title":"retained work"}]',
    );
    if (state !== "external-link") {
      await assert.rejects(readFile(join(f.backups, "backup-root.json")), { code: "ENOENT" });
    } else {
      const listing = await f.run("backup-list", "--backup-root", f.backups);
      assert.equal(
        JSON.parse(listing.stdout).backups.filter((item) => item.status === "usable").length,
        0,
      );
    }
  });
}

test("backup ignores rebuildable profiles, preserves relative links and verifies real SQLite data", async (t) => {
  const f = await backupFixture(t);
  await mkdir(join(f.home, ".zcode/local/profiles/local"), { recursive: true });
  await writeFile(join(f.home, ".zcode/local/profiles/local/cache"), "exclude browser cache");
  await symlink("history.json", join(f.data, ".zcode/v2/history-link"));
  const writer = join(f.root, "sqlite-writer");
  await mkdir(writer);
  // 正常关闭 writer 前复制原生 DB/WAL/SHM，确保恢复内容确实仍在 WAL 中，避免只测 checkpoint 后的主库。
  await exec(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import {DatabaseSync} from 'node:sqlite';
    import fs from 'node:fs/promises';
    import path from 'node:path';
    const dbpath=path.join(process.argv[1],'writer.sqlite');
    const db=new DatabaseSync(dbpath);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE tasks(title TEXT); INSERT INTO tasks VALUES('retained task');");
    for(const suffix of ['', '-wal', '-shm']) await fs.copyFile(dbpath+suffix,path.join(process.argv[2],'tasks-index.sqlite'+suffix));
    db.close();
  `,
    writer,
    join(f.data, ".zcode/v2"),
  ]);
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 0, result.stderr);
  const id = JSON.parse(result.stdout).id;
  await assert.rejects(
    readFile(join(f.backups, id, "payload/home/.zcode/local/profiles/local/cache")),
  );
  const inspection = join(f.root, "restored-inspection");
  await cp(join(f.backups, id, "payload/data/.zcode/v2"), inspection, { recursive: true });
  const restored = await exec("sqlite3", [
    "-readonly",
    join(inspection, "tasks-index.sqlite"),
    "SELECT title FROM tasks;",
  ]);
  assert.equal(restored.stdout.trim(), "retained task");
  assert.equal(
    await readFile(join(f.backups, id, "payload/data/.zcode/v2/history-link"), "utf8"),
    '[{"title":"retained work"}]',
  );
  const verified = await f.run("backup-verify", "--backup-root", f.backups, "--id", id);
  assert.equal(verified.code, 0, verified.stderr);
});

test("retention cannot evict another data identity's only recovery baseline", async (t) => {
  const f = await backupFixture(t);
  const first = await f.run("backup", ...f.args);
  assert.equal(first.code, 0, first.stderr);
  const protectedId = JSON.parse(first.stdout).id;
  const secondData = join(f.root, "another-data");
  await mkdir(join(secondData, ".zcode/v2"), { recursive: true });
  await writeFile(join(secondData, ".zcode/v2/history.json"), "another project history");
  await writeFile(
    join(f.home, ".zcode/v2/setting.json"),
    JSON.stringify({ dataBaseDir: secondData }),
  );
  f.args[f.args.indexOf("--data-root") + 1] = secondData;
  for (let i = 0; i < 4; i++) {
    const result = await f.run("backup", ...f.args);
    assert.equal(result.code, 0, result.stderr);
  }
  const listing = await f.run("backup-list", "--backup-root", f.backups);
  const backups = JSON.parse(listing.stdout).backups;
  assert.equal(backups.filter((item) => item.status === "usable").length, 4);
  assert.ok(backups.some((item) => item.id === protectedId && item.status === "usable"));
});

test("verify rejects corrupted content, path traversal and group aliases without overwriting source", async (t) => {
  const f = await backupFixture(t);
  const saved = await f.run("backup", ...f.args);
  assert.equal(saved.code, 0, saved.stderr);
  const id = JSON.parse(saved.stdout).id;
  await writeFile(join(f.backups, id, "payload/data/.zcode/v2/history.json"), "damaged snapshot");
  const corrupted = await f.run("backup-verify", "--backup-root", f.backups, "--id", id);
  assert.equal(corrupted.code, 1);
  assert.match(corrupted.stderr, /backup-content-mismatch/);
  const escape = await f.run(
    "backup-verify",
    "--backup-root",
    f.backups,
    "--id",
    "../business-data",
  );
  assert.equal(escape.code, 1);
  assert.match(escape.stderr, /backup-id-invalid/);
  const alias = "backup-00000000-0000-0000-0000-000000000000";
  await symlink(f.data, join(f.backups, alias));
  const linked = await f.run("backup-verify", "--backup-root", f.backups, "--id", alias);
  assert.equal(linked.code, 1);
  assert.match(linked.stderr, /backup-root-not-private/);
  assert.equal(
    await readFile(join(f.data, ".zcode/v2/history.json"), "utf8"),
    '[{"title":"retained work"}]',
  );
});

test("backup roots cannot adopt unrelated directories or aliases and concurrent root access stops", async (t) => {
  const f = await backupFixture(t);
  await mkdir(f.backups, { mode: 0o700 });
  await writeFile(join(f.backups, "unrelated"), "preserve");
  const unrelated = await f.run("backup", ...f.args);
  assert.equal(unrelated.code, 1);
  assert.equal(await readFile(join(f.backups, "unrelated"), "utf8"), "preserve");
  const newRoot = join(f.root, "owned-backups");
  f.args[f.args.indexOf("--backup-root") + 1] = newRoot;
  const first = await f.run("backup", ...f.args);
  assert.equal(first.code, 0, first.stderr);
  await mkdir(join(newRoot, ".maintenance-lock"));
  const occupied = await f.run("backup", ...f.args);
  assert.equal(occupied.code, 1);
  assert.match(occupied.stderr, /backup-occupied/);
  const alias = join(f.root, "backup-alias");
  await symlink(newRoot, alias);
  const linked = await f.run("backup-list", "--backup-root", alias);
  assert.equal(linked.code, 1);
  assert.match(linked.stderr, /backup-root-not-private/);
});

test("one root home/data is backed up once with private container permissions", async (t) => {
  const f = await backupFixture(t);
  await writeFile(join(f.home, ".zcode/v2/setting.json"), "{}");
  f.args[f.args.indexOf("--data-root") + 1] = f.home;
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 0, result.stderr);
  const id = JSON.parse(result.stdout).id;
  const manifest = JSON.parse(await readFile(join(f.backups, id, "backup.json"), "utf8"));
  assert.deepEqual(
    manifest.components.map((part) => part.role),
    ["application", "home"],
  );
  const { lstat } = await import("node:fs/promises");
  assert.equal((await lstat(f.backups)).mode & 0o777, 0o700);
  assert.equal((await lstat(join(f.backups, id, "backup.json"))).mode & 0o777, 0o600);
});

test("maintenance holds the launch owner's data locks across the entire copy", async (t) => {
  const f = await backupFixture(t);
  const gate = join(f.root, "copy-started"),
    release = join(f.root, "copy-release");
  const preload = join(f.root, "hold-copy.mjs");
  await writeFile(
    preload,
    `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const copy=fs.promises.cp;let held=false;fs.promises.cp=async(...args)=>{if(!held){held=true;await fs.promises.writeFile(${JSON.stringify(gate)},'ready');while(!fs.existsSync(${JSON.stringify(release)}))await new Promise(r=>setTimeout(r,25));}return copy(...args);};syncBuiltinESMExports();`,
  );
  f.env.NODE_OPTIONS = "--import=" + pathToFileURL(preload).href;
  const first = f.run("backup", ...f.args);
  try {
    const deadline = Date.now() + 10000;
    while (true) {
      try {
        await readFile(gate);
        break;
      } catch (e) {
        if (e.code !== "ENOENT" || Date.now() > deadline) throw e;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    delete f.env.NODE_OPTIONS;
    const competing = [...f.args];
    competing[competing.indexOf("--backup-root") + 1] = join(f.root, "other-backups");
    const second = await f.run("backup", ...competing);
    assert.equal(second.code, 1, second.stdout);
    await assert.rejects(readFile(join(f.root, "other-backups/backup-root.json")), {
      code: "ENOENT",
    });
  } finally {
    await writeFile(release, "release");
  }
  const result = await first;
  assert.equal(result.code, 0, result.stderr);
  const after = await f.run("backup", ...f.args);
  assert.equal(after.code, 0, after.stderr);
});

test("an unconfirmed data redirect cannot initialize a backup root inside the actual business data", async (t) => {
  const f = await backupFixture(t);
  const destination = join(f.data, ".zcode/rejected-backup");
  f.args[f.args.indexOf("--data-root") + 1] = f.home;
  f.args[f.args.indexOf("--backup-root") + 1] = destination;
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /backup-data-root-mismatch/);
  const { lstat } = await import("node:fs/promises");
  await assert.rejects(lstat(destination), { code: "ENOENT" });
});

test("an official application alias cannot hide a backup destination inside the preserved package", async (t) => {
  const f = await backupFixture(t);
  const official = join(f.root, "preserved-official.app"),
    alias = join(f.root, "official-alias.app");
  await mkdir(official);
  await symlink(official, alias);
  const destination = join(official, "rejected-backup");
  f.args[f.args.indexOf("--official-app") + 1] = alias;
  f.args[f.args.indexOf("--backup-root") + 1] = destination;
  const result = await f.run("backup", ...f.args);
  assert.equal(result.code, 1, result.stdout);
  assert.match(result.stderr, /backup-source-overlap/);
  const { lstat } = await import("node:fs/promises");
  await assert.rejects(lstat(destination), { code: "ENOENT" });
});
