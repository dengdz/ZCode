import { readFile, access, realpath, lstat } from "node:fs/promises";
import { resolve, join, relative, isAbsolute, parse, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { git, run, fail } from "./process.mjs";
import { createHash } from "node:crypto";
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export const within = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
export async function cleanSource() {
  if (await git("status", "--porcelain=v1", "--untracked-files=all")) fail("source-not-clean");
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ]) {
    const path = await git("rev-parse", "--git-path", marker);
    try {
      await access(path);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    fail("git-operation-in-progress");
  }
}
async function canonicalPath(path) {
  const absolute = resolve(path);
  try {
    return await realpath(absolute);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return join(await canonicalPath(dirname(absolute)), basename(absolute));
  }
}
export async function safeOutput(value) {
  if (!value || !isAbsolute(value)) fail("explicit-output-required");
  const requested = resolve(value);
  const parent = await realpath(resolve(requested, ".."));
  const output = join(parent, parse(requested).base);
  const repo = await realpath(await git("rev-parse", "--show-toplevel"));
  for (const forbiddenPath of [
    repo,
    join(homedir(), ".zcode"),
    join(homedir(), ".zcode-dev-home"),
    join(homedir(), "Applications"),
    "/Applications",
    "/System",
    "/Library",
    ...(process.env.ZCODE_DATA_BASE_DIR ? [process.env.ZCODE_DATA_BASE_DIR] : []),
  ]) {
    // 日常根和候选根必须使用同一真实路径语义，避免符号链接别名绕过数据隔离。
    const forbidden = await canonicalPath(forbiddenPath);
    if (within(forbidden, output) || within(output, forbidden)) fail("unsafe-output");
  }
  try {
    await lstat(output);
  } catch (e) {
    if (e.code === "ENOENT") return output;
    throw e;
  }
  fail("output-exists");
}
export async function remotePolicy(fork) {
  const one = async (key, expected) => {
    if ((await git("config", "--get-all", key)) !== expected) fail("remote-policy");
  };
  await one("remote.origin.url", `https://github.com/${fork}.git`);
  if (
    (await git("remote", "get-url", "--all", "origin")) !== `https://github.com/${fork}.git` ||
    (await git("remote", "get-url", "--push", "--all", "origin")) !==
      `https://github.com/${fork}.git`
  )
    fail("remote-policy");
  await one("remote.upstream.url", "https://github.com/zai-org/ZCode.git");
  if (
    (await git("remote", "get-url", "--all", "upstream")) !== "https://github.com/zai-org/ZCode.git"
  )
    fail("remote-policy");
  await one("remote.upstream.pushurl", "DISABLED");
  if ((await git("remote", "get-url", "--push", "--all", "upstream")) !== "DISABLED")
    fail("remote-policy");
  await one("remote.pushDefault", "origin");
  await one("push.default", "simple");
}
export async function publicContent(base) {
  const raw = await git(
    "log",
    "--format=",
    "--raw",
    "-z",
    "--no-renames",
    "--diff-merges=first-parent",
    "--no-abbrev",
    "--diff-filter=AM",
    `${base}..HEAD`,
  );
  // 三方合并的 first-parent diff 也含官方已公开 blob；只排除可从固定官方历史证明的相同对象，不豁免整个测试目录。
  const upstreamObjects = new Set(
    (await git("rev-list", "--objects", "--no-object-names", base)).split("\n"),
  );
  const blobs = new Set();
  const fields = raw.split("\0");
  for (let i = 0; i < fields.length; i++) {
    const header = fields[i].trim();
    if (!header.startsWith(":")) continue;
    const path = fields[++i];
    if (
      !path ||
      /(^|\/)(\.env(?:\.[^/]+)?(?<!\.example)(?<!\.sample)(?<!\.template)|credentials?\.json|private|raw-interviews?|backups?|group-chat|research)(\/|$)/i.test(
        path,
      )
    )
      fail("public-content-path");
    const blob = header.split(" ")[3];
    if (blob && !upstreamObjects.has(blob)) blobs.add(blob);
  }
  for (const blob of blobs) {
    const text = await git("cat-file", "blob", blob);
    if (
      /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bsk-[A-Za-z0-9]{32,}\b/.test(
        text,
      )
    )
      fail("public-content-secret");
  }
  return {
    checkedBlobs: blobs.size,
    scope: `${base}..HEAD`,
    semanticPrivacy: "requires-maintainer-review",
  };
}
export async function check(fork, reviewPath) {
  await remotePolicy(fork);
  await cleanSource();
  const pkg = await json("package.json");
  const version = pkg.version;
  const parts = /^(\d+\.\d+\.\d+)-local\.([1-9]\d{0,2})$/.exec(version);
  const branch = await git("branch", "--show-current");
  if (!parts || branch !== version) fail("version-branch");
  const commit = await git("rev-parse", "HEAD");
  let pushRemote;
  try {
    pushRemote = await git("config", "--get-all", `branch.${branch}.pushRemote`);
  } catch (e) {
    if (!e.maintenanceCode) throw e;
  }
  if (pushRemote && pushRemote !== "origin") fail("remote-policy");
  if (
    (await realpath(process.cwd())) !== (await realpath(await git("rev-parse", "--show-toplevel")))
  )
    fail("repository-root-required");
  const forkInfo = JSON.parse(
    await run("gh", ["api", "--hostname", "github.com", `repos/${fork}`]),
  );
  if (
    forkInfo.full_name !== fork ||
    forkInfo.owner?.login !== fork.split("/")[0] ||
    forkInfo.private !== false ||
    forkInfo.fork !== true ||
    forkInfo.source?.full_name !== "zai-org/ZCode"
  )
    fail("fork-not-verified");
  const observation = JSON.parse(
    await run("gh", ["api", "--hostname", "github.com", "repos/zai-org/ZCode/commits/main"]),
  );
  const upstreamCommit = observation.sha;
  if (!/^[a-f0-9]{40}$/.test(upstreamCommit ?? "")) fail("upstream-observation-invalid");
  // GitHub Git 传输不可达时，API 仍可验证已持有对象的远端锚点；缺少对象必须实际 fetch，不能把旧本地 ref 当作最新。
  try {
    await git("cat-file", "-e", `${upstreamCommit}^{commit}`);
  } catch {
    await git("fetch", "--no-tags", "upstream", upstreamCommit);
  }
  await git("cat-file", "-e", `${upstreamCommit}^{commit}`);
  await git("update-ref", "refs/remotes/upstream/main", upstreamCommit);
  const upstreamPackage = JSON.parse(await git("show", `${upstreamCommit}:package.json`));
  const release = JSON.parse(
    await run("gh", ["api", "--hostname", "github.com", "repos/zai-org/ZCode/releases/latest"]),
  );
  const reviewBytes = await readFile(reviewPath);
  const review = JSON.parse(reviewBytes);
  if (
    review.schema !== 1 ||
    !/^[a-f0-9]{40}$/.test(review.officialBase ?? "") ||
    review.officialVersion !== parts[1] ||
    !Array.isArray(review.blockers) ||
    !Array.isArray(review.patches) ||
    review.patches.length === 0 ||
    review.publicContentReviewed !== true ||
    typeof review.capabilityEvidence !== "string" ||
    !review.capabilityEvidence.trim()
  )
    fail("review-invalid");
  await git("merge-base", "--is-ancestor", review.officialBase, commit);
  await git("merge-base", "--is-ancestor", review.officialBase, upstreamCommit);
  if (JSON.parse(await git("show", `${review.officialBase}:package.json`)).version !== parts[1])
    fail("official-base-version");
  for (const patch of review.patches) {
    if (
      !/^[a-f0-9]{40}$/.test(patch.commit ?? "") ||
      !["retain", "retired"].includes(patch.decision) ||
      !patch.evidence?.trim()
    )
      fail("review-invalid");
    await git("cat-file", "-e", `${patch.commit}^{commit}`);
  }
  const cherry = await git("cherry", upstreamCommit, commit);
  const equivalent = cherry
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
  const publicAudit = await publicContent(review.officialBase);
  const tag = `v${version}`;
  let localTag = null;
  try {
    localTag = await git("rev-parse", "--verify", `refs/tags/${tag}^{commit}`);
  } catch (e) {
    if (!e.maintenanceCode) throw e;
  }
  const refs = JSON.parse(
    await run("gh", [
      "api",
      "--hostname",
      "github.com",
      `repos/${fork}/git/matching-refs/tags/${tag}`,
    ]),
  );
  if (!Array.isArray(refs)) fail("tag-check-failed");
  const remoteTag = refs.find((ref) => ref.ref === `refs/tags/${tag}`);
  if (remoteTag) {
    await git("fetch", "--no-tags", "origin", `refs/tags/${tag}`);
    if ((await git("rev-parse", "FETCH_HEAD^{commit}")) !== commit)
      fail("published-version-use-new-revision");
  }
  if (localTag && localTag !== commit) fail("published-version-use-new-revision");
  const blockers = [...review.blockers];
  if (!/^\d+\.\d+\.\d+$/.test(upstreamPackage.version)) blockers.push("upstream-source-not-stable");
  if (review.upstreamCommit !== upstreamCommit) blockers.push("upstream-review-stale");
  const retiredEquivalent = [];
  for (const patch of equivalent) {
    if (review.patches.some((item) => item.commit === patch && item.decision === "retired")) {
      const diff = await git("show", "--format=", "--binary", patch);
      try {
        // 仅检查补丁能重新应用，不写工作树；已删除本地效果且明确审核后才允许退役。
        await run("git", ["apply", "--check", "--binary", "-"], { input: diff + "\n" });
        retiredEquivalent.push(patch);
        continue;
      } catch (e) {
        if (!e.maintenanceCode) throw e;
      }
    }
    blockers.push("equivalent-patches-require-retirement");
  }
  return {
    schema: 1,
    kind: "check",
    source: {
      version,
      branch,
      commit,
      tree: await git("rev-parse", "HEAD^{tree}"),
      tag,
      tagCreated: false,
    },
    fork,
    upstream: {
      observation: "github-api",
      observedAt: new Date().toISOString(),
      commit: upstreamCommit,
      version: upstreamPackage.version,
      latestRelease: release.tag_name,
    },
    officialBase: review.officialBase,
    review: { ...review, sha256: digest(reviewBytes) },
    publicAudit,
    equivalentPatches: equivalent,
    retiredEquivalent,
    blockers,
    buildAllowed: blockers.length === 0,
  };
}
