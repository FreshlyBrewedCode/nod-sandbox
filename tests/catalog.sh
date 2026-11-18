#!/usr/bin/env bash
# Every widget costs at least ten euros.
! grep -E 'cents: [0-9]{1,3} ' app/catalog.ts
