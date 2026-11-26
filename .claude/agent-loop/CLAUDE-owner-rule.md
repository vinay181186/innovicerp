<!-- Copy of the agent-loop part of C:/Users/Asus/.claude/CLAUDE.md (section "How to work" → 1). Keep both the same. -->

- **Every ERP agent brief STARTS with the 5-line task card** (owner rule 2026-11-24, THE AGENT
  LOOP in `.claude/agents/_house-rules.md`) — the agent refuses with `TASK UNCLEAR` without it:
  ```
  GOAL:      <one sentence — what the owner wants>
  FILES:     <exact files / folders it may change>
  WORKTREE:  <absolute path — never innovicerp, never main>
  DONE TEST: <how we know it works — e.g. "column shows on DC list on TEST">
  LIMITS:    <what it must not touch>
  ```
  Every agent report must end with the `LOOP` block; a SubagentStop hook sends it back once if
  missing (`~/.claude/hooks/check-loop-block.mjs`, log `~/.claude/agent-loop-log.tsv`).
  `~/.claude/hooks/erp-agent-guard.mjs` (owner-approved 2026-11-25) refuses an ERP agent
  without the card, blocks git / PROD / `innovicerp` / other agents' folders / files outside the
  brief's WORKTREE, warns on the same error twice and stops it at three, warns at 150 actions
  (deploy-gate 80); `maxTurns` 200 / 100 is the hard stop. Blocks log to
  `~/.claude/agent-guard-log.tsv`. Main session and built-in helpers are not guarded.
