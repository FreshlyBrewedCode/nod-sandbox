/**
 * What a pull request needs before it may merge. This file belongs to this
 * repository: read it, change it, delete what you don't need.
 *
 * `.nod/verify.ts` runs it on every PR, always from the default branch and
 * never from the PR itself. A change to it is a PR like any other, and since
 * it is under `.nod/`, that PR always needs a peer's nod.
 *
 * How it works, in two steps:
 *
 * 1. **Classifiers** look at the PR and report findings, each with a tag and
 *    a risk from 0 (none) to 3 (high): "3 files under docs/**", "+1240 −12
 *    in 18 files", "module billing is tier 1".
 * 2. **Rules** turn findings into what the PR needs:
 *    - `none`: nobody has to nod; the PR merges on its own once CI is green;
 *    - `self`: the human behind the agent (the PR author) nods, or anyone enrolled;
 *    - `peer`: someone other than the PR author nods;
 *    - `named("login")`: that person nods.
 *
 * Everything combines to the strictest: the risk is the highest risk of any
 * finding, and no rule can lower what another rule asked for. On top of the
 * rules, the kit always asks for a peer when `.nod/**` or
 * `.github/workflows/**` change, and when a classifier or rule crashes.
 *
 * The PR's category follows: `decide` when someone has to nod, `fyi` when a
 * rule marked it as worth knowing about, `auto` otherwise.
 */
import {
  declared,
  definePolicy,
  dependencies,
  diffSize,
  fyi,
  matchAny,
  paths,
  peer,
  rule,
  self,
} from "@frebreco/nod/kit";

import { moduleTiers } from "./classifiers/module-tier.ts";

/** Files that are documentation: a PR touching only these merges on its own. */
const DOCS = ["docs/**", "**/*.md", "**/*.mdx", "LICENSE"];

export default definePolicy({
  classifiers: [
    // Tags by path. A pattern matches the whole path from the repo root;
    // `**` spans folders. Add your own risky or harmless places here.
    paths({
      ".nod/**": { tag: "nod-setup", risk: 3 },
      ".github/**": { tag: "ci-config", risk: 3 },
      "docs/**": { tag: "docs", risk: 0 },
      "*.md": { tag: "docs", risk: 0 }, // README.md and friends at the root
      // "migrations/**": { tag: "migration", risk: 3 },
      // "src/auth/**": { tag: "auth", risk: 2 },
      // "**/*.test.ts": { tag: "tests", risk: 0 },
    }),

    // Size of the change, lockfiles and generated files left out:
    // under 50 lines none, from 50 low, from 400 medium, from 1000 high.
    // Tune it: diffSize({ thresholds: { 1: 100, 2: 600, 3: 1500 } }).
    diffSize(),

    // Dependency manifests and lockfiles: a bump alone is low risk,
    // dependencies changing along with code medium.
    dependencies(),

    // An example of your own classifier (.nod/classifiers/module-tier.ts):
    // module tiers from modules/<name>/module.json, core/ is high risk.
    moduleTiers(),

    // What the PR brief declares: "Risk: high", "FYI", "Depends on #12".
    // Declarations can only raise risk, never lower it.
    declared(),
  ],

  rules: [
    rule("high risk needs a peer", (f) => f.risk >= 3 && peer),
    rule("medium or low risk needs a self nod", (f) => f.risk >= 1 && self),

    // Code needs at least the author's own nod. Docs-only PRs and pure
    // tier-3 module updates merge on their own.
    rule(
      "code needs a self nod",
      (f) => !f.files.every((file) => matchAny(DOCS, file.path)) && !f.has("pure-module") && self,
    ),

    // Worth knowing about, without asking anyone to nod.
    rule("declared FYI", (f) => f.has("fyi") && fyi),

    // More ideas:
    // rule("billing needs alice", (f) => f.has("tier-1") && named("alice")),
    // rule("big changes need a peer", (f) => f.has("size:l", "size:xl") && peer),
    // rule("migrations need alice and a peer", (f) => f.has("migration") && [named("alice"), peer]),
    // To let something through, narrow the rule that asks for more: a rule
    // returning `none` adds nothing, it cannot lower another rule's ask.
  ],
});
