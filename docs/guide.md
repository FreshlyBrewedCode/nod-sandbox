# Guide

How the widgets service is laid out.

- `core/`: the scheduler and engine everything runs on
- `modules/<name>/`: features; `module.json` says how critical each is (tier 1 to 3)
- `app/`: the HTTP entry point
