import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const entry = resolve("scripts/local-maintenance.mjs");
async function fixture(t, { publicBlob } = {}) {
  const root = await mkdtemp(join(tmpdir(), "zcode-maintenance-"));
  const repo = join(root, "repo");
  await mkdir(repo);
  const git = async (...args) => (await exec("git", args, { cwd: repo })).stdout.trim();
  await git("init", "-b", "3.16.2-local.1");
  await git("config", "user.email", "fixture@example.invalid");
  await git("config", "user.name", "Fixture");
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ version: "3.16.2", packageManager: "pnpm@10.33.2" }),
  );
  await writeFile(join(repo, "mise.toml"), '[tools]\nnode = "24.14.0"\npnpm = "10.33.2"\n');
  await writeFile(join(repo, "pnpm-lock.yaml"), "fixture lock\n");
  if (publicBlob) await writeFile(join(repo, "published-sample.txt"), publicBlob);
  await git("add", ".");
  await git("commit", "-m", "fixture");
  await git("remote", "add", "origin", "https://github.com/zai-org/ZCode.git");
  const output = join(root, "candidate");
  const env = { ...process.env };
  async function run(...args) {
    try {
      return { code: 0, ...(await exec(process.execPath, [entry, ...args], { cwd: repo, env })) };
    } catch (e) {
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  }
  t.diagnostic(root);
  return { root, repo, git, output, run, env };
}
test("maintenance refuses the official origin without changing remotes or creating a candidate", async (t) => {
  const f = await fixture(t);
  const r = await f.run("check", "--fork", "fixture/ZCode", "--output", f.output);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /remote-policy/);
  assert.equal(await f.git("remote", "get-url", "origin"), "https://github.com/zai-org/ZCode.git");
  await assert.rejects(readFile(join(f.output, "candidate.json")));
});

async function remotes(f) {
  await f.git("remote", "set-url", "origin", "https://github.com/fixture/ZCode.git");
  await f.git("remote", "add", "upstream", "https://github.com/zai-org/ZCode.git");
  await f.git("remote", "set-url", "--push", "upstream", "DISABLED");
  await f.git("config", "remote.pushDefault", "origin");
  await f.git("config", "push.default", "simple");
}
test("maintenance blocks uncommitted source before network or build", async (t) => {
  const f = await fixture(t);
  await remotes(f);
  await writeFile(join(f.repo, "uncommitted.txt"), "keep me");
  const r = await f.run("build", "--fork", "fixture/ZCode", "--output", f.output);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /source-not-clean/);
  assert.equal(await readFile(join(f.repo, "uncommitted.txt"), "utf8"), "keep me");
});
async function checkedFixture(t, options) {
  const f = await fixture(t, options);
  await remotes(f);
  const base = await f.git("rev-parse", "HEAD");
  const upstream = join(f.root, "upstream.git");
  await exec("git", ["clone", "--bare", f.repo, upstream]);
  await exec("git", ["--git-dir", upstream, "branch", "main", base]);
  await f.git("config", `url.${upstream}.insteadOf`, "https://github.com/zai-org/ZCode.git");
  await f.git("config", `url.${upstream}.pushInsteadOf`, "unused");
  // get-url 展开 insteadOf；测试在 Git 系统边界只重定向 fetch，保留远端配置可验证。
  const bin = join(f.root, "bin");
  await mkdir(bin);
  const realGit = (await exec("which", ["git"])).stdout.trim();
  await writeFile(
    join(bin, "git"),
    `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nconst a=process.argv.slice(2);\nif(a[0]==='fetch') a.splice(a.indexOf('upstream'),1,${JSON.stringify(upstream)});\nconst r=spawnSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});process.exit(r.status??1);\n`,
    { mode: 0o755 },
  );
  await f.git("config", "--remove-section", `url.${upstream}`);
  await writeFile(
    join(f.repo, "package.json"),
    JSON.stringify({ version: "3.16.2-local.1", packageManager: "pnpm@10.33.2" }),
  );
  await f.git("add", ".");
  await f.git("commit", "-m", "local identity");
  await writeFile(
    join(bin, "gh"),
    `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.at(-1).endsWith('commits/main')?{sha:'${base}'}:process.argv.at(-1).includes('matching-refs')?[]:process.argv.at(-1).endsWith('releases/latest')?{tag_name:'v3.14.3',draft:false,prerelease:false}:{full_name:'fixture/ZCode',private:false,fork:true,owner:{login:'fixture'},source:{full_name:'zai-org/ZCode'}}));\n`,
    { mode: 0o755 },
  );
  f.env.PATH = `${bin}:${f.env.PATH}`;
  const review = join(f.root, "review.json");
  await writeFile(
    review,
    JSON.stringify({
      schema: 1,
      upstreamCommit: base,
      officialBase: base,
      officialVersion: "3.16.2",
      publicContentReviewed: true,
      capabilityEvidence: "fixture source review",
      blockers: [],
      patches: [{ commit: base, decision: "retain", evidence: "fixture differs" }],
    }),
  );
  return { ...f, base, review, bin };
}
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
async function buildTools(f, { arch = process.arch } = {}) {
  const directory = arch === "arm64" ? "mac-arm64" : "mac";
  const asarModule = (
    await exec(
      process.execPath,
      ["-p", "require.resolve('@electron/asar', {paths:['./packages/desktop']})"],
      { cwd: resolve(".") },
    )
  ).stdout.trim();
  await mkdir(join(f.repo, "node_modules/electron"), { recursive: true });
  await writeFile(join(f.repo, "node_modules/electron/install.js"), "// synthetic installer\n");
  await writeFile(join(f.repo, ".gitignore"), "node_modules/\n");
  await f.git("add", ".gitignore");
  await f.git("commit", "-m", "fixture ignore");
  const metadata = {
    appVersion: "3.16.2-local.1",
    buildCommitId: (await f.git("rev-parse", "HEAD")).slice(0, 8),
    buildTime: "2026-10-23T00:00:00.000Z",
  };
  await writeFile(
    join(f.bin, "pnpm"),
    `#!${process.execPath}
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const args=process.argv.slice(2);
if(args.includes('--version')) { console.log('10.33.2'); process.exit(0); }
if(args[0]==='store') { console.log(${JSON.stringify(join(f.root, "store"))});process.exit(0); }
if(args[0]!=='bundle:desktop') process.exit(0);
const root=process.env.ZCODE_DESKTOP_DIST_DIR;
const app=join(root,'${directory}','ZCode Local.app');
const source=join(root,'asar-source');
await mkdir(join(source,'out/metadata'),{recursive:true});
await writeFile(join(source,'package.json'),JSON.stringify({version:'3.16.2-local.1',zcodeProductFlavor:'local'}));
await writeFile(join(source,'out/metadata/build-meta.json'),${JSON.stringify(JSON.stringify(metadata))});
await mkdir(join(app,'Contents/Resources'),{recursive:true});
await mkdir(join(app,'Contents/MacOS'),{recursive:true});
await writeFile(join(app,'Contents/MacOS/ZCode Local'),'synthetic');
await writeFile(join(app,'Contents/Info.plist'),'synthetic');
await mkdir(join(app,'Contents/Frameworks/Required.framework'),{recursive:true});
await writeFile(join(app,'Contents/Frameworks/Required.framework/binary'),'required framework fixture');
const {createPackage}=createRequire(import.meta.url)(${JSON.stringify(asarModule)});
await createPackage(source,join(app,'Contents/Resources/app.asar'));
await writeFile(join(root,'ZCode Local-3.16.2-local.1-mac-${arch}.dmg'),'synthetic dmg');
const zip=join(root,'ZCode Local-3.16.2-local.1-mac-${arch}.zip');
const r=spawnSync('zip',['-qr',zip,'ZCode Local.app'],{cwd:join(root,'${directory}')});process.exit(r.status??1);
`,
    { mode: 0o755 },
  );
  for (const name of ["codesign"])
    await writeFile(
      join(f.bin, name),
      `#!${process.execPath}\nconsole.error('Signature=adhoc\\nflags=0x10000(runtime)');\n`,
      { mode: 0o755 },
    );
  await writeFile(
    join(f.bin, "hdiutil"),
    `#!${process.execPath}
import {cp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const args=process.argv.slice(2);
if(args[0]==='attach') {
 const mount=args[args.indexOf('-mountpoint')+1];
 await cp(join(process.env.ZCODE_DESKTOP_DIST_DIR,'${directory}','ZCode Local.app'),join(mount,'ZCode Local.app'),{recursive:true});
 if(process.env.FIXTURE_DMG_STALE) await writeFile(join(mount,'ZCode Local.app/Contents/Resources/app.asar'),'stale');
}
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(f.bin, "lipo"),
    `#!${process.execPath}\nconsole.log('${arch === "x64" ? "x86_64" : arch}');\n`,
    {
      mode: 0o755,
    },
  );
  await writeFile(
    join(f.bin, "plutil"),
    `#!${process.execPath}\nconsole.log(JSON.stringify({CFBundleIdentifier:'dev.zcode.app.local',CFBundleName:'ZCode Local',CFBundleShortVersionString:'3.16.2',CFBundleVersion:'3.16.2001'}));\n`,
    { mode: 0o755 },
  );
}
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
