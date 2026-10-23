import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fixture, remotes, checkedFixture, buildTools } from "./test/local-maintenance-fixture.mjs";
const exec = promisify(execFile);

test("maintenance refuses the official origin without changing remotes or creating a candidate", async (t) => {
  const f = await fixture(t);
  const r = await f.run("check", "--fork", "fixture/ZCode", "--output", f.output);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /remote-policy/);
  assert.equal(await f.git("remote", "get-url", "origin"), "https://github.com/zai-org/ZCode.git");
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});

test("maintenance blocks uncommitted source before network or build", async (t) => {
  const f = await fixture(t);
  await remotes(f);
  await writeFile(join(f.repo, "uncommitted.txt"), "keep me");
  const r = await f.run("build", "--fork", "fixture/ZCode", "--output", f.output);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /source-not-clean/);
  assert.equal(await readFile(join(f.repo, "uncommitted.txt"), "utf8"), "keep me");
});

test("explicit check reports pinned upstream and release separately, without building", async (t) => {
  const f = await checkedFixture(t);
  const r = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(await readFile(join(f.output, "check.json"), "utf8"));
  assert.equal(report.source.commit, await f.git("rev-parse", "HEAD"));
  assert.equal(report.upstream.commit, f.base);
  assert.equal(report.upstream.latestRelease, "v3.14.3");
  assert.equal(report.buildAllowed, true);
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});
test("dependency preparation failure stops the existing build chain and never marks a candidate ready", async (t) => {
  const f = await checkedFixture(t);
  await writeFile(
    join(f.bin, "pnpm"),
    `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('10.33.2'); else process.exit(23);\n`,
    { mode: 0o755 },
  );
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /command-failed:pnpm/);
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});

test("build emits an immutable traceable manifest only after packaged metadata and artifacts verify", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f);
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 0, r.stderr);
  const candidate = JSON.parse(await readFile(join(f.output, "candidate.json"), "utf8"));
  assert.equal(candidate.status, "ready");
  assert.equal(candidate.source.commit, await f.git("rev-parse", "HEAD"));
  assert.equal(candidate.package.version, "3.16.2-local.1");
  assert.equal(candidate.artifacts.length, 2);
  assert.match(candidate.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(candidate.started, false);
  assert.equal(candidate.installed, false);
  const again = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(again.code, 1);
  assert.match(again.stderr, /output-exists/);
});
test("a private environment file remains blocked even after deletion from HEAD", async (t) => {
  const f = await checkedFixture(t);
  await writeFile(join(f.repo, ".env.production"), "PRIVATE_CONFIGURATION=fixture");
  await f.git("add", ".env.production");
  await f.git("commit", "-m", "private fixture");
  await f.git("rm", ".env.production");
  await f.git("commit", "-m", "remove private fixture");
  const r = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /public-content-path/);
});
test("concurrent builds cannot share the repository build outputs", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f);
  const lock = await f.git("rev-parse", "--git-path", "local-maintenance.lock");
  await mkdir(join(f.repo, lock));
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /build-occupied/);
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});
test("upstream freshness records an actual GitHub API observation even when the commit is already local", async (t) => {
  const f = await checkedFixture(t);
  const r = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(await readFile(join(f.output, "check.json"), "utf8"));
  assert.equal(report.upstream.observation, "github-api");
});

test("a valid DMG container with a stale application cannot become a ready candidate", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f);
  const tool = join(f.bin, "hdiutil");
  await writeFile(
    tool,
    (await readFile(tool, "utf8")).replace("process.env.FIXTURE_DMG_STALE", "true"),
  );
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /dmg-package-mismatch/);
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});
test("a patch already solved upstream can retire after its local effect is removed", async (t) => {
  const f = await checkedFixture(t);
  await writeFile(join(f.repo, "feature.txt"), "same patch\n");
  await f.git("add", ".");
  await f.git("commit", "-m", "local patch");
  const patch = await f.git("rev-parse", "HEAD");
  const other = join(f.root, "official");
  await exec("git", ["clone", join(f.root, "upstream.git"), other]);
  const upstreamGit = async (...args) => (await exec("git", args, { cwd: other })).stdout.trim();
  await upstreamGit("checkout", "main");
  await upstreamGit("config", "user.email", "official@example.invalid");
  await upstreamGit("config", "user.name", "Official fixture");
  await writeFile(join(other, "feature.txt"), "same patch\n");
  await upstreamGit("add", ".");
  await upstreamGit("commit", "-m", "official fix");
  await upstreamGit("push", "origin", "main");
  const upstream = await upstreamGit("rev-parse", "HEAD");
  await f.git("fetch", join(f.root, "upstream.git"), "main");
  const gh = join(f.bin, "gh");
  await writeFile(gh, (await readFile(gh, "utf8")).replace(`sha:'${f.base}'`, `sha:'${upstream}'`));
  const review = JSON.parse(await readFile(f.review, "utf8"));
  review.upstreamCommit = upstream;
  review.patches = [
    { commit: patch, decision: "retired", evidence: "exact official fix; local effect reverted" },
  ];
  await writeFile(f.review, JSON.stringify(review));
  const retained = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(retained.code, 1);
  await f.git("revert", "--no-edit", patch);
  const r = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    join(f.root, "retired-candidate"),
  );
  assert.equal(r.code, 0, r.stderr);
});
for (const scenario of [
  "stale-review",
  "published-version",
  "private-fork",
  "conflict",
  "multiple-push-urls",
  "unsafe-output",
]) {
  test(`maintenance stops ${scenario} at the public command boundary`, async (t) => {
    const f = await checkedFixture(t);
    let output = f.output;
    const expected = {
      "stale-review": "upstream-review-stale",
      "published-version": "published-version-use-new-revision",
      "private-fork": "fork-not-verified",
      conflict: "git-operation-in-progress",
      "multiple-push-urls": "remote-policy",
      "unsafe-output": "unsafe-output",
    }[scenario];
    if (scenario === "stale-review") {
      const r = JSON.parse(await readFile(f.review, "utf8"));
      r.upstreamCommit = "0".repeat(40);
      await writeFile(f.review, JSON.stringify(r));
    }
    if (scenario === "published-version") await f.git("tag", "v3.16.2-local.1", f.base);
    if (scenario === "private-fork") {
      const p = join(f.bin, "gh");
      await writeFile(p, (await readFile(p, "utf8")).replace("private:false", "private:true"));
    }
    if (scenario === "conflict")
      await writeFile(
        join(f.repo, await f.git("rev-parse", "--git-path", "MERGE_HEAD")),
        f.base + "\n",
      );
    if (scenario === "multiple-push-urls") {
      await f.git(
        "config",
        "--add",
        "remote.origin.pushurl",
        "https://github.com/fixture/ZCode.git",
      );
      await f.git(
        "config",
        "--add",
        "remote.origin.pushurl",
        "https://github.com/zai-org/ZCode.git",
      );
    }
    if (scenario === "unsafe-output") output = join(f.repo, "candidate");
    const r = await f.run(
      "check",
      "--fork",
      "fixture/ZCode",
      "--review",
      f.review,
      "--output",
      output,
    );
    assert.equal(r.code, 1, r.stdout);
    if (scenario === "stale-review")
      assert.ok(
        JSON.parse(await readFile(join(output, "check.json"), "utf8")).blockers.includes(expected),
      );
    else assert.match(r.stderr, new RegExp(expected));
    await assert.rejects(readFile(join(output, "candidate.json")));
  });
}
test("failed signature verification leaves artifacts unready", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f);
  await writeFile(join(f.bin, "codesign"), `#!${process.execPath}\nprocess.exit(21);\n`);
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /command-failed:codesign/);
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});

test("byte-identical public upstream objects do not block a generic local source copy", async (t) => {
  const publicBlob = "sk-" + "x".repeat(32);
  const f = await checkedFixture(t, { publicBlob });
  await writeFile(join(f.repo, "public-source-copy.txt"), publicBlob);
  await f.git("add", ".");
  await f.git("commit", "-m", "copy published sample");
  const r = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 0, r.stderr);
});
test("isolated HOME keeps the established dependency store without purging modules", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f);
  const tool = join(f.bin, "pnpm");
  await writeFile(
    tool,
    (await readFile(tool, "utf8")).replace(
      "if(args[0]!=='bundle:desktop')",
      `if(args[0]==='store') { console.log(${JSON.stringify(join(f.root, "store"))});process.exit(0); }\nif(args[0]==='install'&&!args.includes('--store-dir')) process.exit(25);\nif(args[0]!=='bundle:desktop')`,
    ),
  );
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 0, r.stderr);
});

test("a symlinked daily data root is still forbidden as candidate output", async (t) => {
  const f = await checkedFixture(t);
  const actual = join(f.root, "daily-data"),
    alias = join(f.root, "daily-link");
  await mkdir(actual);
  await symlink(actual, alias);
  f.env.ZCODE_DATA_BASE_DIR = alias;
  const r = await f.run(
    "check",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    join(alias, "candidate"),
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unsafe-output/);
  await assert.rejects(readFile(join(actual, "candidate/check.json")));
});

test("Intel macOS follows electron-builder mac directory and Mach-O x86_64 naming", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f, { arch: "x64" });
  const preload = join(f.root, "intel-host.mjs");
  await writeFile(preload, "Object.defineProperty(process,'arch',{value:'x64'});\n");
  f.env.NODE_OPTIONS = "--import=" + pathToFileURL(preload).href;
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 0, r.stderr);
  const c = JSON.parse(await readFile(join(f.output, "candidate.json"), "utf8"));
  assert.equal(c.arch, "x64");
  assert.equal(c.app, "artifacts/mac/ZCode Local.app");
});

test("a ZIP missing framework members cannot become a ready candidate", async (t) => {
  const f = await checkedFixture(t);
  await buildTools(f);
  const tool = join(f.bin, "pnpm");
  await writeFile(
    tool,
    (await readFile(tool, "utf8")).replace(
      "['-qr',zip,'ZCode Local.app']",
      "['-q',zip,'ZCode Local.app/Contents/Resources/app.asar','ZCode Local.app/Contents/Info.plist','ZCode Local.app/Contents/MacOS/ZCode Local']",
    ),
  );
  const r = await f.run(
    "build",
    "--fork",
    "fixture/ZCode",
    "--review",
    f.review,
    "--output",
    f.output,
  );
  assert.equal(r.code, 1);
  assert.match(r.stderr, /archive-package-mismatch/);
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});
