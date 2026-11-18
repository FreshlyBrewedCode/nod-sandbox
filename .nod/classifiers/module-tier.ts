/**
 * EXAMPLE custom classifier: delete this file, or adapt it to how your repo is
 * organised. It shows the shape every classifier has: a plain function from
 * the PR to a list of findings. `.nod/policy.ts` decides what the findings
 * mean.
 *
 * The idea, "module tiers": the code lives in `modules/<name>/`, and each
 * module says how critical it is in `modules/<name>/module.json`:
 *
 *     { "tier": 1 }    1 = critical (billing, auth), 2 = normal, 3 = leaf (icons, copy)
 *
 * - The tier is read from the **base branch**, never from the PR, so a PR
 *   cannot lower its own module's tier on the way in.
 * - A PR that only changes tier-3 modules is a "pure module update": tagged
 *   `pure-module`, no risk of its own.
 * - Tier 1, or anything under `core/`, is high risk.
 * - A module without a readable tier on the base (e.g. a new module) is
 *   medium risk until its `module.json` has landed.
 *
 * If your repo has no `modules/`, this classifier finds nothing and costs
 * nothing.
 */
import { matchAny, type Classifier, type Finding, type Risk } from "@frebreco/nod/kit";

export interface ModuleTierOptions {
  /** Where modules live (default `modules`): `<root>/<name>/module.json`. */
  root?: string;
  /** Paths that are always high risk (default `core/**`). */
  core?: readonly string[];
  /** Risk per tier (default: tier 1 high, tier 2 medium, tier 3 none). */
  riskOfTier?: Readonly<Record<number, Risk>>;
}

export function moduleTiers(options: ModuleTierOptions = {}): Classifier {
  const root = (options.root ?? "modules").replace(/\/+$/, "");
  const core = options.core ?? ["core/**"];
  const riskOfTier = options.riskOfTier ?? { 1: 3, 2: 2, 3: 0 };

  // A named function, so a crash shows up as "moduleTiers: …" in the check.
  return async function moduleTiers({ files, readBaseFile }) {
    const findings: Finding[] = [];
    const modules = new Set<string>();
    const corePaths: string[] = [];
    let elsewhere = 0;

    for (const f of files) {
      const m = f.path.startsWith(`${root}/`)
        ? /^([^/]+)\//.exec(f.path.slice(root.length + 1))
        : null;
      if (m) modules.add(m[1]!);
      else if (matchAny(core, f.path)) corePaths.push(f.path);
      else elsewhere++;
    }

    if (corePaths.length) {
      findings.push({
        classifier: "moduleTiers",
        tag: "core",
        risk: 3,
        detail: `touches core: ${corePaths.slice(0, 3).join(", ")}${corePaths.length > 3 ? ` and ${corePaths.length - 3} more` : ""}`,
      });
    }

    let onlyTier3 = modules.size > 0;
    for (const name of [...modules].sort()) {
      const tier = await baseTier(readBaseFile, `${root}/${name}/module.json`);
      if (tier !== 3) onlyTier3 = false;
      const risk = tier === null ? undefined : riskOfTier[tier];
      if (risk === undefined) {
        findings.push({
          classifier: "moduleTiers",
          tag: "unknown-tier",
          risk: 2,
          detail: `module ${name} has no tier on the base branch yet`,
        });
      } else {
        findings.push({
          classifier: "moduleTiers",
          tag: `tier-${tier}`,
          risk,
          detail: `module ${name} is tier ${tier}`,
        });
      }
    }

    if (onlyTier3 && corePaths.length === 0 && elsewhere === 0) {
      findings.push({
        classifier: "moduleTiers",
        tag: "pure-module",
        detail: "only tier-3 modules change",
      });
    }
    return findings;
  };
}

/** The `tier` in a module.json on the base branch, or `null` when it is missing or unreadable. */
async function baseTier(
  readBaseFile: (path: string) => Promise<string | null>,
  path: string,
): Promise<number | null> {
  const text = await readBaseFile(path);
  if (text === null) return null;
  try {
    const tier = (JSON.parse(text) as { tier?: unknown }).tier;
    return typeof tier === "number" && Number.isInteger(tier) ? tier : null;
  } catch {
    return null;
  }
}
