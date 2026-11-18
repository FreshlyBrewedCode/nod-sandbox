# nod-sandbox

Throwaway sandbox for nod (FreshlyBrewedCode/nod). Fictional service "widgets", fictional people
(alice, bob, carol) and fictional agents. Not production code.

- `.nod/` and `.github/workflows/nod.yml`: nod's repo-owned setup, added by `nod init`.
- `modules/<name>/module.json`: each module's tier (1 critical … 3 leaf), read by the example
  classifier in `.nod/classifiers/module-tier.ts`.
- `core/`: shared code, always high risk. `docs/`: documentation, merges on its own.
