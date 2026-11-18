#!/usr/bin/env bash
# CI: run every test under tests/. Runs PR code with the default read-only token.
set -e
for t in tests/*.sh; do echo "== $t"; bash "$t"; done
echo "tests pass"
