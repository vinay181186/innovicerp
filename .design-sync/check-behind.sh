#!/usr/bin/env sh
# Says whether Claude Design is behind the code, comparing the commit last synced
# (.design-sync/last-sync-commit, updated after every sync) with the given ref (default HEAD).
# Only what Claude Design shows counts: the shared kit, its styles and the sync setup.
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would rewrite origin/test:path as a file path
REF="${1:-HEAD}"
SYNCED=$(git show "$REF:.design-sync/last-sync-commit" 2>/dev/null | tr -d '[:space:]')
[ -n "$SYNCED" ] || { echo "Claude Design: last sync not recorded"; exit 0; }
if git diff --quiet "$SYNCED" "$REF" -- \
  apps/web/src/ui apps/web/src/styles apps/web/src/index.css \
  apps/web/src/components/shared/searchable-select.tsx \
  packages/shared/src/lib/column-align.ts \
  .design-sync/config.json .design-sync/conventions.md .design-sync/previews \
  ':(exclude,glob)apps/web/src/ui/**/*.test.*' ':(exclude)apps/web/src/ui/standard-frozen.json'; then
  echo "Claude Design: up to date"
else
  echo "Claude Design: BEHIND. Tell the owner to type /design-sync."
fi
