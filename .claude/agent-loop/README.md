# Agent loop — master copy

This folder is the **git copy** of the agent-loop locks. The PC runs its own copy in
`C:\Users\Asus\.claude\`. Git is the master: change it here first.

| File here | Live copy on the PC |
|---|---|
| `hooks/erp-agent-guard.mjs` | `~/.claude/hooks/erp-agent-guard.mjs` |
| `hooks/check-loop-block.mjs` | `~/.claude/hooks/check-loop-block.mjs` |
| `settings-hooks.json` | the `"hooks"` part of `~/.claude/settings.json` |
| `CLAUDE-owner-rule.md` | the task-card / LOOP part of `~/.claude/CLAUDE.md` |
| `tests/guardtest.mjs` | — (56 checks) |
| `docs/*.pdf` | reading guides (`make_flow_pdf.py` builds the full-flow PDF) |

The agent rules themselves are in `.claude/agents/` (STEP 0b, `_house-rules.md`).

## How to change a lock

1. Edit the file **here**.
2. Run the tests: `node .claude/agent-loop/tests/guardtest.mjs` → must say `0 failed`.
3. Copy it to the PC: `cp .claude/agent-loop/hooks/*.mjs ~/.claude/hooks/`
   (settings or CLAUDE.md change → paste the same lines by hand).
4. Test the live copy: `node .claude/agent-loop/tests/guardtest.mjs ~/.claude/hooks`
5. Commit with explicit paths, push to `test`; `main` when the owner says.

## Check the PC copy matches git

```sh
diff .claude/agent-loop/hooks/erp-agent-guard.mjs ~/.claude/hooks/erp-agent-guard.mjs
diff .claude/agent-loop/hooks/check-loop-block.mjs ~/.claude/hooks/check-loop-block.mjs
```
No output = same.

## New PC

Copy `hooks/*.mjs` to `~/.claude/hooks/`, add the `settings-hooks.json` lines to
`~/.claude/settings.json`, add `CLAUDE-owner-rule.md` to `~/.claude/CLAUDE.md`, run the tests,
restart Claude.
