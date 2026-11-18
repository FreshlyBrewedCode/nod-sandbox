# nod-sandbox

Throwaway sandbox for spike 1 of nod (FreshlyBrewedCode/nod#3). Not production code.

- `.nod/verify.ts` + `.github/workflows/nod.yml`: the verifier (runs from the base ref, sets the `nod` check on the PR head SHA).
- `.nod/allowed_signers`: fictional signers alice (principal `FreshlyBrewedCode`) and bob (principal `bob`).
- `core/`: changes here need a peer nod; `app/`: a self nod is enough.
