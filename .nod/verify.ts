/**
 * The nod verifier: the one thing that decides whether a PR may merge.
 *
 * `.github/workflows/nod.yml` runs this file on every PR event and every PR
 * comment, always from the default branch: the policy, the trust root and
 * this code are the default branch's, never the PR's. Nothing from the PR is
 * checked out, installed or run; its commits are fetched as git objects and
 * only diffed.
 *
 * Top to bottom, one run:
 *  1. read the event: which PR
 *  2. fetch the PR's base tip and head commit as git objects
 *  3. changed files and patch-id, from git
 *  4. classify with the policy (.nod/policy.ts)
 *  5. verify every nod block in the PR's comments with ssh-keygen,
 *     against .nod/allowed_signers
 *  6. evaluate: which nods count, is the requirement met
 *  7. create the check run `nod` on the head SHA (success or failure only),
 *     with the machine-readable summary in its output
 *  8. update the sticky comment and the display labels
 *
 * A crash ends as a red `nod` check with the error in its summary, never as
 * a green one. The helpers come from `@frebreco/nod/kit`; the crypto is
 * OpenSSH's and the diff is git's.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildSummary,
  changedFiles,
  checkConclusion,
  checkTitle,
  createCheckRun,
  encodeSummary,
  enrolledLogins,
  evaluateNods,
  evaluatePolicy,
  fetchPullRequestObjects,
  getPullRequest,
  gitFileReader,
  githubRequest,
  listIssueComments,
  parseNodComments,
  patchId,
  peer,
  prDeepLink,
  renderSticky,
  summaryLabels,
  syncLabels,
  upsertStickyComment,
  verifyNodBlocks,
  type CheckSummary,
  type GitHubOptions,
  type PolicyResult,
  type PullRequest,
} from "@frebreco/nod/kit";

/** Where the sticky comment's "Open in nod" link points. */
const UI_BASE = "https://ui.nod.frebreco.de";

/** The repo root: the default branch, checked out by the workflow. */
const ROOT = join(import.meta.dir, "..");
/** The trust root (ADR 0002): who can nod, from the default branch. */
const ALLOWED_SIGNERS = join(import.meta.dir, "allowed_signers");

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const repo = env("GITHUB_REPOSITORY");
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";

/** Reads, comments and labels: the workflow's own token. */
const gh: GitHubOptions = { token: env("GITHUB_TOKEN"), repo, apiUrl };

// ─── The check token (ADR 0003) ─────────────────────────────────────────────
// Actions mode (v1, the default): the workflow's GITHUB_TOKEN creates the
// check, so it comes from the GitHub Actions app, and the ruleset requires
// `nod` from that app. Limit: a workflow pushed on any branch can create a
// `nod` check from the same app.
// App mode (hardening, later): the workflow mints a token of your own GitHub
// App in a job that only the default branch may run (environment `nod`) and
// passes it as NOD_CHECK_TOKEN; the ruleset then requires `nod` from that app.
// This is the only place that changes.
const checks: GitHubOptions = { ...gh, token: process.env.NOD_CHECK_TOKEN || gh.token };
// ─────────────────────────────────────────────────────────────────────────────

// 1. Read the event: which PR. The event file is GitHub's, but its PR fields
//    may be stale; the PR itself is fetched fresh below.
const event = JSON.parse(await readFile(env("GITHUB_EVENT_PATH"), "utf8")) as {
  pull_request?: { number: number; head?: { sha?: string } };
  issue?: { number: number; pull_request?: unknown };
};
const number = event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : 0);
if (!number) {
  console.log("not a pull request event: nothing to do");
  process.exit(0);
}

let pr: PullRequest | undefined;
try {
  pr = await getPullRequest(gh, number);
  if (pr.state !== "open") {
    console.log(`#${number} is ${pr.state}: nothing to do`);
    process.exit(0);
  }
  const summary = await verify(pr);
  await report(pr, summary);
} catch (error) {
  // Fail closed: a red check that says what broke.
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error::nod verifier: ${message}`);
  const head = pr?.head_sha ?? event.pull_request?.head?.sha;
  if (!head) process.exit(1); // nothing to put a check on; the job itself fails
  await createCheckRun(checks, {
    head_sha: head,
    conclusion: "failure",
    title: `verifier error: ${message}`.slice(0, 200),
    summary: `The nod verifier crashed, so this PR cannot merge until it runs cleanly.\n\n> ${message}`,
    text: encodeSummary(failedSummary(pr, number, head, message)),
  });
  process.exit(1);
}

/** Steps 2 to 6: everything up to the verdict. */
async function verify(pr: PullRequest): Promise<CheckSummary> {
  // 2. The PR's base tip and head commit, as objects only.
  const baseTip = await fetchPullRequestObjects({
    repoDir: ROOT,
    base: pr.base,
    headSha: pr.head_sha,
    token: gh.token,
    serverUrl,
  });
  const range = { repoDir: ROOT, baseTip, head: pr.head_sha };

  // 3. What changed, from git (not the files API, which stops at 3000 files).
  const files = await changedFiles(range);
  const state = {
    repo,
    number: pr.number,
    author: pr.author,
    base: pr.base,
    head_sha: pr.head_sha,
    patch_id: await patchId(range),
  };

  // 4. Classify with the default branch's policy. Imported here, so that a
  //    broken policy file ends as a red check too. Classifiers read trusted
  //    files from the PR's base tip.
  const policy = (await import("./policy.ts")).default;
  const result = await evaluatePolicy(policy, {
    pr: { ...state, title: pr.title, body: pr.body, labels: pr.labels },
    files,
    readBaseFile: gitFileReader(ROOT, baseTip),
  });

  // 5. Verify every nod block in every comment. Who posted a comment never matters.
  const comments = await listIssueComments(gh, pr.number);
  const blocks = comments.flatMap((c) => parseNodComments(c.body));
  const { verified, rejected } = await verifyNodBlocks(blocks, {
    allowedSignersPath: ALLOWED_SIGNERS,
  });

  // 6. Which nods count, and is the requirement met?
  const nods = evaluateNods({ pr: state, requirement: result.requirement, verified, rejected });
  const signers = enrolledLogins(await readFile(ALLOWED_SIGNERS, "utf8"));
  return buildSummary({ pr: state, policy: result, nods, signers });
}

/** Steps 7 and 8: tell GitHub. The check is the gate; the rest is display. */
async function report(pr: PullRequest, summary: CheckSummary): Promise<void> {
  const sticky = renderSticky(summary, { uiBase: UI_BASE });

  // 7. The check run `nod` on the head SHA: the only thing the ruleset reads.
  await createCheckRun(checks, {
    head_sha: pr.head_sha,
    conclusion: checkConclusion(summary),
    title: checkTitle(summary),
    summary: sticky,
    text: encodeSummary(summary),
    details_url: prDeepLink(UI_BASE, repo, pr.number),
  });
  console.log(`nod ${checkConclusion(summary)} on ${pr.head_sha}: ${checkTitle(summary)}`);

  // 8. Display only: a failure here never changes the verdict.
  try {
    await upsertStickyComment(gh, pr.number, sticky);
    const wanted = summaryLabels(summary);
    await createMissingLabels(wanted.filter((l) => !pr.labels.includes(l)));
    await syncLabels(gh, pr.number, wanted, { current: pr.labels });
  } catch (error) {
    console.log(`::warning::nod: sticky comment or labels: ${(error as Error).message}`);
  }
}

/** Creates the `nod:*` labels with a colour the first time they are used. */
async function createMissingLabels(labels: readonly string[]): Promise<void> {
  const colours: Record<string, string> = {
    "nod:auto": "2da44e",
    "nod:decide": "d4a72c",
    "nod:fyi": "0969da",
    "nod:risk-0": "e6e6e6",
    "nod:risk-1": "c5def5",
    "nod:risk-2": "f9d0c4",
    "nod:risk-3": "e99695",
  };
  for (const name of labels) {
    try {
      await githubRequest(gh, "POST", `/repos/${repo}/labels`, {
        name,
        color: colours[name] ?? "ededed",
        description: "set by the nod verifier; display only",
      });
    } catch {
      // 422: it exists already
    }
  }
}

/** The summary of a run that crashed: needs a peer, satisfied never. */
function failedSummary(
  pr: PullRequest | undefined,
  prNumber: number,
  head: string,
  message: string,
): CheckSummary {
  const policyResult: PolicyResult = {
    category: "decide",
    risk: 3,
    requirement: peer,
    fyi: false,
    reasons: [],
    rules: [],
    errors: [],
  };
  return buildSummary({
    pr: {
      repo,
      number: prNumber,
      author: pr?.author ?? "",
      base: pr?.base ?? "",
      head_sha: head,
      patch_id: "",
    },
    policy: policyResult,
    nods: { nods: [], satisfied: false, missing: [{ kind: "peer" }] },
    signers: [],
    errors: [message],
  });
}
