# Architecture

Requests enter through `app/server.ts`, which dispatches to modules. Modules never import each
other directly; shared code lives in `core/`.

## Retries

Jobs that fail are not retried yet. See the open discussion on retrying in `core/`.
