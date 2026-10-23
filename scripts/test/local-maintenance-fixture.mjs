import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const entry = resolve("scripts/local-maintenance.mjs");
export async function fixture(t, { publicBlob } = {}) {
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

export async function remotes(f) {
  await f.git("remote", "set-url", "origin", "https://github.com/fixture/ZCode.git");
  await f.git("remote", "add", "upstream", "https://github.com/zai-org/ZCode.git");
  await f.git("remote", "set-url", "--push", "upstream", "DISABLED");
  await f.git("config", "remote.pushDefault", "origin");
  await f.git("config", "push.default", "simple");
}

export async function checkedFixture(t, options) {
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

export async function buildTools(f, { arch = process.arch } = {}) {
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
