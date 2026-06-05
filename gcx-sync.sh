#!/bin/bash
# gcx-sync: fetch all remotes, merge latest, push to all 3 repos
# Usage: gcx-sync          → sync only (no commit, just pull latest)
#        gcx-sync push     → sync + push local commits to all 3 repos

set -e
REPO="$HOME/Desktop/GCX"
cd "$REPO"

echo "==> Fetching all remotes..."
git fetch --all

LOCAL=$(git rev-parse main)
ORIGIN=$(git rev-parse origin/main)
SPIGEN=$(git rev-parse spigenHQ/main)
ARRHA=$(git rev-parse arrha/main)

BEHIND=0
for REMOTE in origin/main spigenHQ/main arrha/main; do
  AHEAD=$(git log HEAD.."$REMOTE" --oneline | wc -l | tr -d ' ')
  if [ "$AHEAD" -gt 0 ]; then
    echo "  ⚠ $REMOTE is $AHEAD commit(s) ahead of local"
    BEHIND=1
  fi
done

if [ "$BEHIND" -eq 1 ]; then
  echo "==> Merging remote changes into local..."
  git merge origin/main spigenHQ/main arrha/main --no-edit
  echo "==> Local is now up to date."
else
  echo "==> Local is already up to date with all remotes."
fi

if [ "$1" = "push" ]; then
  echo "==> Pushing to all 3 repos..."
  git push origin main
  echo "==> Done. Pushed to:"
  echo "    - codingintheusa0402/spigen-gcx-automation"
  echo "    - spigenHQ/HQ_GCX"
  echo "    - arrha-spigen/RHA_RHA_LAND_spg"
fi
