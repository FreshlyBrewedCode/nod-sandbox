// Spike helpers shared by the local signer and the verifier. NOT production code.
import { spawnSync } from "node:child_process";

// Neutralise user/system git config so signer and verifier produce the same diff.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// The pinned diff. Every flag here fixes something that would otherwise depend on config or repo size.
export const DIFF_ARGS = [
  "--no-color", "--no-ext-diff", "--no-textconv",
  "--no-renames",              // rename detection is heuristic (and limited by renameLimit)
  "--full-index",              // binary diffs hash the index line; abbreviated SHAs depend on repo size
  "--diff-algorithm=myers", "--indent-heuristic", "-U3",
  "--src-prefix=a/", "--dst-prefix=b/",
];

export function git(dir: string, args: string[], input?: string): string {
  const r = spawnSync("git", ["-C", dir, ...args], { env: GIT_ENV, input, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** patch-id of a PR = git patch-id --stable over the pinned diff merge-base(base, head)..head. "" for an empty diff. */
export function patchId(dir: string, baseRev: string, headSha: string): { mergeBase: string; patchId: string } {
  const mergeBase = git(dir, ["merge-base", baseRev, headSha]).trim();
  // --attr-source=<empty tree>: ignore .gitattributes, which the PR itself could change.
  const diff = git(dir, ["--attr-source=" + EMPTY_TREE, "diff", ...DIFF_ARGS, mergeBase, headSha]);
  const out = git(dir, ["patch-id", "--stable"], diff).trim();
  return { mergeBase, patchId: out.split(/\s+/)[0] ?? "" };
}

export function patchIdOfDiffText(dir: string, diff: string): string {
  return git(dir, ["patch-id", "--stable"], diff).trim().split(/\s+/)[0] ?? "";
}

export type Entry = { pr: number; base: string; head_sha: string; patch_id: string };
export type Payload = { v: 1; repo: string; entries: Entry[]; verdict: "approve"; level: string; reviewer: string; signed_at: string };

/** Canonical payload line: keys in a fixed order, no whitespace. The signature covers exactly this line. */
export function canonical(p: Payload): string {
  return JSON.stringify({
    v: p.v, repo: p.repo,
    entries: p.entries.map((e) => ({ pr: e.pr, base: e.base, head_sha: e.head_sha, patch_id: e.patch_id })),
    verdict: p.verdict, level: p.level, reviewer: p.reviewer, signed_at: p.signed_at,
  });
}

export const BLOCK_RE = /```nod\r?\n(\{[^\r\n]{1,32768}\})\r?\n(-----BEGIN SSH SIGNATURE-----\r?\n[A-Za-z0-9+/=\r\n]{1,8192}?-----END SSH SIGNATURE-----)\r?\n```/g;

export function renderComment(payloadLine: string, armoredSig: string, human: string): string {
  return `${human}\n\n\`\`\`nod\n${payloadLine}\n${armoredSig.trim()}\n\`\`\`\n`;
}
