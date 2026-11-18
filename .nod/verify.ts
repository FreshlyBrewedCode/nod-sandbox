// nod verifier, spike version. NOT production code.
// Runs from the BASE ref checkout. Never checks out or executes PR code; PR commits are fetched as data only.
// Inputs come from env (numbers and fixed strings only); comment bodies, titles and branch names are data.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOCK_RE, git, patchId, patchIdOfDiffText, type Payload } from "./lib.ts";

// Concept rule: an entry counts if head_sha OR patch_id matches. STRICT_BASE also requires entry.base == PR base.
const STRICT_BASE = process.env.NOD_STRICT_BASE !== "0";
const PEER_PATHS = [/^core\//, /^\.nod\//, /^\.github\//];
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

const repo = process.env.GITHUB_REPOSITORY!;
const token = process.env.GITHUB_TOKEN!;
const prNumber = Number(process.env.PR_NUMBER);
if (!Number.isInteger(prNumber) || prNumber <= 0) throw new Error("bad PR_NUMBER");
const t0 = Date.now();

async function gh(path: string, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, accept: init.accept ?? "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(init.headers ?? {}) },
  });
  return r;
}
async function ghJson(path: string): Promise<any> {
  const r = await gh(path);
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function paginate(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page < 50; page++) {
    const items = await ghJson(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
}

const pr = await ghJson(`/repos/${repo}/pulls/${prNumber}`);
const headSha: string = pr.head.sha;
const baseRef: string = pr.base.ref;
const author: string = pr.user.login;

// --- patch-id: fetch base tip and PR head as data, diff locally with the pinned flags
const auth = "AUTHORIZATION: basic " + Buffer.from(`x-access-token:${token}`).toString("base64");
git(".", ["-c", `http.https://github.com/.extraheader=${auth}`, "fetch", "--no-tags", "--quiet", "origin",
  `+refs/heads/${baseRef}:refs/nod/base`, headSha]);
const local = patchId(".", "refs/nod/base", headSha);

// --- policy (spike): touching core/, .nod/ or .github/ needs a peer; everything else a self nod is enough.
// The file list comes from git, NOT from the files API: that API stops at 3000 files, so a padded PR
// could hide a core/ change from the policy (shown on PR #5 of the sandbox).
const files = git(".", ["diff", "--name-only", "-z", "--no-renames", local.mergeBase, headSha]).split("\0").filter(Boolean);
const apiFileCount = (await ghJson(`/repos/${repo}/pulls/${prNumber}`)).changed_files;
const needsPeer = files.some((f) => PEER_PATHS.some((re) => re.test(f)));
const requirement = needsPeer ? "peer" : "self";
// for comparison only: the API's diff (capped by GitHub's diff limits)
let apiPatchId = "", apiDiffStatus = 0;
{
  const r = await gh(`/repos/${repo}/pulls/${prNumber}`, { accept: "application/vnd.github.diff" });
  apiDiffStatus = r.status;
  if (r.ok) apiPatchId = patchIdOfDiffText(".", await r.text());
}

// --- nods: every ```nod block in every comment; the comment author is irrelevant, only the signature counts
const comments = await paginate(`/repos/${repo}/issues/${prNumber}/comments`);
const tmp = mkdtempSync(join(tmpdir(), "nod-"));
const results: any[] = [];
for (const c of comments) {
  let n = 0;
  for (const m of String(c.body ?? "").matchAll(BLOCK_RE)) {
    if (++n > 20) break;
    const payloadLine = m[1], sig = m[2].replace(/\r/g, "") + "\n";
    const res: any = { comment_id: c.id, comment_author: c.user?.login };
    results.push(res);
    let p: Payload;
    try { p = JSON.parse(payloadLine); } catch { res.error = "payload is not JSON"; continue; }
    if (typeof p.reviewer !== "string" || !LOGIN_RE.test(p.reviewer)) { res.error = "bad reviewer"; continue; }
    res.reviewer = p.reviewer;
    const pf = join(tmp, `p-${c.id}-${n}`), sf = join(tmp, `s-${c.id}-${n}`);
    writeFileSync(pf, payloadLine); writeFileSync(sf, sig);
    const v = spawnSync("ssh-keygen", ["-Y", "verify", "-f", ".nod/allowed_signers", "-I", p.reviewer, "-n", "nod", "-s", sf],
      { input: readFileSync(pf), encoding: "utf8" });
    if (v.status !== 0) { res.error = "signature invalid: " + (v.stderr || v.stdout).trim().slice(0, 200); continue; }
    res.signature = "valid";
    if (String(p.repo).toLowerCase() !== repo.toLowerCase()) { res.error = `nod is for repo ${p.repo}`; continue; }
    if (p.verdict !== "approve") { res.error = `verdict ${p.verdict}`; continue; }
    const e = Array.isArray(p.entries) ? p.entries.find((x) => x && x.pr === prNumber) : undefined;
    if (!e) { res.error = "no entry for this PR"; continue; }
    if (STRICT_BASE && e.base !== baseRef) { res.error = `entry base ${e.base} != PR base ${baseRef}`; continue; }
    res.matched = e.head_sha === headSha ? "head_sha" : (local.patchId && e.patch_id === local.patchId) ? "patch_id" : null;
    if (!res.matched) { res.error = "stale: neither head_sha nor patch_id matches"; continue; }
    res.kind = p.reviewer.toLowerCase() === author.toLowerCase() ? "self" : "peer";
    res.level = p.level;
  }
}
const valid = results.filter((r) => !r.error);
const ok = requirement === "self" ? valid.length > 0 : valid.some((r) => r.kind === "peer");
const by = valid.map((r) => `${r.reviewer} (${r.kind}, ${r.matched})`).join(", ");
const title = ok ? `nodded by ${by}` : `waiting for a ${requirement} nod` + (valid.length ? ` (have: ${by})` : "");
const summary = {
  pr: prNumber, head_sha: headSha, base: baseRef, author, requirement, strict_base: STRICT_BASE,
  files: files.length, api_changed_files: apiFileCount,
  patch_id: local.patchId, merge_base: local.mergeBase, api_patch_id: apiPatchId, api_diff_status: apiDiffStatus,
  event: process.env.GITHUB_EVENT_NAME, run: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  nods: results, verifier_ms: Date.now() - t0,
};
console.log(JSON.stringify(summary, null, 2));

// --- the check run on the PR HEAD SHA (a pull_request_target job's own checks land on the base commit)
const body = {
  name: "nod", head_sha: headSha, status: "completed", conclusion: ok ? "success" : "failure",
  external_id: `nod:${prNumber}`,
  output: { title, summary: `requirement: **${requirement}** · author: ${author} · patch-id \`${local.patchId.slice(0, 12)}\``, text: "```json\n" + JSON.stringify(summary, null, 2) + "\n```" },
};
const r = await gh(`/repos/${repo}/check-runs`, { method: "POST", body: JSON.stringify(body) });
const cr: any = await r.json();
if (!r.ok) throw new Error(`check run: ${r.status} ${JSON.stringify(cr)}`);
console.log(`check run ${cr.id} ${cr.conclusion} on ${headSha}: ${title}`);
