# Guide

How the widgets service is laid out.

- `core/`: the scheduler and engine everything runs on
- `modules/<name>/`: features; `module.json` says how critical each is (tier 1 to 3)
- `app/`: the HTTP entry point

## Glossary

- **tier**: how critical a module is, from 1 (critical) to 3 (leaf).
- **nod**: a signed approval of a PR by an enrolled human.
