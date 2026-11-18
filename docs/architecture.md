# Architecture

Requests enter through `app/server.ts`, which dispatches to modules. Modules never import each
other directly; shared code lives in `core/`.
