#!/usr/bin/env bash
# The service's smoke test: the files the app needs are there.
test -f app/server.ts && test -f core/scheduler.ts
