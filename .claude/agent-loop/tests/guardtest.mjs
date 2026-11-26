// Test suite for erp-agent-guard.mjs and check-loop-block.mjs — pipes sample hook inputs.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Tests the repo copy by default; pass a folder to test another copy (e.g. ~/.claude/hooks).
const DIR = process.argv[2] || fileURLToPath(new URL('../hooks/', import.meta.url));
const G = DIR + '/erp-agent-guard.mjs';
const L = DIR + '/check-loop-block.mjs';
const SID = 'guardtest-' + Date.now();
let pass = 0, fail = 0;
function run(script, mode, obj) {
  const r = spawnSync('node', mode ? [script, mode] : [script], { input: JSON.stringify(obj), encoding: 'utf8' });
  return r.stdout || '';
}
function t(name, expect, mode, obj) {
  const out = run(G, mode, obj);
  const r = out.includes('"deny"') ? 'BLOCK' : out.includes('additionalContext') ? 'WARN' : 'ALLOW';
  const ok = r === expect; ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.padEnd(6)} ${name}${ok ? '' : '   <-- expected ' + expect + ' ' + out.slice(0, 200)}`);
}
function x(name, expect, obj) {
  const out = run(L, null, obj);
  const r = out.includes('"block"') ? 'SENTBACK' : 'ACCEPT';
  const ok = r === expect; ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${r.padEnd(8)} ${name}${ok ? '' : '   <-- expected ' + expect}`);
}
const card = (type, prompt) => ({ session_id: SID, tool_name: 'Agent', tool_input: { subagent_type: type, prompt } });
const CARD = 'GOAL: add column\nFILES: apps/web/src/a.tsx\nWORKTREE: C:/Innovic_projects/innovic-erp/wt-layout\nDONE TEST: shows on TEST\nLIMITS: no api';
const CARD_MD = '**GOAL:** add column\n**FILES:** `apps/web/src/a.tsx`\n**WORKTREE:** `C:\\Innovic_projects\\innovic-erp\\wt-layout`\n**DONE TEST:** shows\n**LIMITS:** none';

console.log('--- 1. task card (agent start)');
t('ERP agent, full card', 'ALLOW', 'card', card('erp-frontend', CARD));
t('ERP agent, card in bold markdown', 'ALLOW', 'card', card('erp-backend', CARD_MD));
t('ERP agent, no card', 'BLOCK', 'card', card('erp-backend', 'add a column to clients'));
t('ERP agent, DONE TEST missing', 'BLOCK', 'card', card('erp-test', 'GOAL: x\nFILES: y\nWORKTREE: C:/a\nLIMITS: z'));
t('ERP agent, WORKTREE = innovicerp', 'BLOCK', 'card', card('erp-frontend', CARD.replace('wt-layout', 'innovicerp')));
t('Explore helper, no card', 'ALLOW', 'card', card('Explore', 'find x'));
t('general-purpose helper, no card', 'ALLOW', 'card', card('general-purpose', 'find x'));
// bind brief → agent A1 (erp-frontend, wt-layout)
run(G, 'start', { session_id: SID, agent_id: 'A1-' + SID, agent_type: 'erp-frontend', hook_event_name: 'SubagentStart' });

const A = (tool, ti) => ({ session_id: SID, agent_id: 'A1-' + SID, agent_type: 'erp-frontend', tool_name: tool, tool_input: ti });
const B = (tool, ti) => ({ session_id: SID, agent_id: 'B1-' + SID, agent_type: 'erp-backend', tool_name: tool, tool_input: ti });
const W = 'C:/Innovic_projects/innovic-erp/wt-layout/';

console.log('--- 2. erp-frontend actions (brief WORKTREE = wt-layout)');
t('edit apps/web/src file (Windows path)', 'ALLOW', 'action', A('Edit', { file_path: 'C:\\Innovic_projects\\innovic-erp\\wt-layout\\apps\\web\\src\\a.tsx' }));
t('edit apps/api (backend folder)', 'BLOCK', 'action', A('Edit', { file_path: W + 'apps/api/src/x.ts' }));
t('edit packages/shared', 'BLOCK', 'action', A('Edit', { file_path: W + 'packages/shared/src/x.ts' }));
t('write e2e spec (erp-test folder)', 'BLOCK', 'action', A('Write', { file_path: W + 'apps/web/e2e/x.spec.ts' }));
t('edit in a different worktree', 'BLOCK', 'action', A('Edit', { file_path: 'C:/Innovic_projects/innovic-erp/wt-test/apps/web/src/a.tsx' }));
t('edit innovicerp', 'BLOCK', 'action', A('Edit', { file_path: 'C:/Innovic_projects/innovic-erp/innovicerp/apps/web/src/a.tsx' }));
t('edit ~/.claude/settings.json', 'BLOCK', 'action', A('Edit', { file_path: 'C:/Users/Asus/.claude/settings.json' }));
t('edit own agent file', 'BLOCK', 'action', A('Edit', { file_path: 'C:/Users/Asus/.claude/agents/erp-frontend.md' }));
t('write temp file', 'ALLOW', 'action', A('Write', { file_path: 'C:/Users/Asus/AppData/Local/Temp/x.txt' }));
t('read any file', 'ALLOW', 'action', A('Read', { file_path: W + 'apps/api/src/x.ts' }));
t('bash: git status', 'ALLOW', 'action', A('Bash', { command: 'git -C wt-layout status --short' }));
t('bash: git diff / log', 'ALLOW', 'action', A('Bash', { command: 'git diff HEAD -- apps/web && git log --oneline -3' }));
t('bash: git commit', 'BLOCK', 'action', A('Bash', { command: 'git add a.tsx && git commit -m x' }));
t('bash: git -C path push', 'BLOCK', 'action', A('Bash', { command: 'git -C C:/x push origin test' }));
t('bash: git stash', 'BLOCK', 'action', A('Bash', { command: 'git stash' }));
t('bash: git checkout -- file', 'BLOCK', 'action', A('Bash', { command: 'git checkout -- apps/web/src/a.tsx' }));
t('bash: pnpm build', 'ALLOW', 'action', A('Bash', { command: 'pnpm --filter web build' }));
t('bash: grep for "commit" word', 'ALLOW', 'action', A('Bash', { command: 'grep -rn "commit" apps/web/src | head' }));
t('bash: sed -i into innovicerp', 'BLOCK', 'action', A('Bash', { command: 'sed -i s/a/b/ ../innovicerp/x.ts' }));
t('bash: read file in innovicerp', 'ALLOW', 'action', A('Bash', { command: 'cat ../innovicerp/CLAUDE.md | head' }));
t('bash: read house rules', 'ALLOW', 'action', A('Bash', { command: 'cat C:/Users/Asus/.claude/agents/_house-rules.md' }));
t('bash: write into ~/.claude/hooks', 'BLOCK', 'action', A('Bash', { command: 'echo x > C:/Users/Asus/.claude/hooks/a.mjs' }));

console.log('--- 3. erp-backend actions (no brief bound → any wt-* worktree)');
t('edit apps/api file', 'ALLOW', 'action', B('Edit', { file_path: 'C:/Innovic_projects/innovic-erp/wt-x/apps/api/src/x.ts' }));
t('edit apps/web (frontend folder)', 'BLOCK', 'action', B('Edit', { file_path: 'C:/Innovic_projects/innovic-erp/wt-x/apps/web/src/a.tsx' }));
t('apply-sql on TEST', 'ALLOW', 'action', B('Bash', { command: 'cd apps/api && npx tsx src/db/apply-sql.ts migrations/0263.sql' }));
t('apply-sql DB_TARGET=PROD', 'BLOCK', 'action', B('Bash', { command: 'DB_TARGET=PROD npx tsx src/db/apply-sql.ts m.sql' }));
t('drizzle-kit migrate', 'BLOCK', 'action', B('Bash', { command: 'npx drizzle-kit migrate' }));
t('pnpm db:push', 'BLOCK', 'action', B('Bash', { command: 'pnpm db:push' }));
t('PROD project ref in a command', 'BLOCK', 'action', B('Bash', { command: 'psql postgres://x@db.ctbrlcdwfddhlscnoyos.supabase.co' }));
t('release-prod.sh', 'BLOCK', 'action', B('Bash', { command: 'sh release/release-prod.sh' }));
t('git push origin main', 'BLOCK', 'action', B('Bash', { command: 'git push origin test:main' }));

console.log('--- 4. other agents + main session');
const G1 = (type, tool, ti) => ({ session_id: SID, agent_id: 'G1-' + SID, agent_type: type, tool_name: tool, tool_input: ti });
t('erp-deploy-gate tries an Edit', 'BLOCK', 'action', G1('erp-deploy-gate', 'Edit', { file_path: 'C:/Innovic_projects/innovic-erp/wt-x/apps/web/src/a.tsx' }));
t('erp-deploy-gate runs typecheck', 'ALLOW', 'action', G1('erp-deploy-gate', 'Bash', { command: 'pnpm -r typecheck' }));
t('erp-test writes e2e spec', 'ALLOW', 'action', G1('erp-test', 'Write', { file_path: 'C:/Innovic_projects/innovic-erp/wt-x/apps/web/e2e/dc.spec.ts' }));
t('bug-tracer edits apps/api', 'ALLOW', 'action', G1('bug-tracer', 'Edit', { file_path: 'C:/Innovic_projects/innovic-erp/wt-x/apps/api/src/x.ts' }));
t('page-registry-builder writes registry', 'ALLOW', 'action', G1('page-registry-builder', 'Write', { file_path: 'C:/Innovic_projects/innovic-erp/wt-x/docs/page-registry.yaml' }));
t('MAIN session git commit (not guarded)', 'ALLOW', 'action', { session_id: SID, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } });
t('Explore helper git commit (not guarded)', 'ALLOW', 'action', G1('Explore', 'Bash', { command: 'git commit -m x' }));

console.log('--- 5. same error repeated');
const F = { ...A('Bash', { command: 'pnpm build' }), error: 'Exit code 1\nTS2304: Cannot find name foo', duration_ms: 120 };
t('1st failure → nothing', 'ALLOW', 'fail', F);
t('2nd same failure → change approach', 'WARN', 'fail', F);
const third = run(G, 'fail', F); const ok3 = third.includes('STOP now'); ok3 ? pass++ : fail++;
console.log(`${ok3 ? 'PASS' : 'FAIL'} WARN   3rd same failure → "STOP now"`);
t('different error → nothing', 'ALLOW', 'fail', { ...F, error: 'Exit code 1\nother problem' });

console.log('--- 6. exit check (LOOP block)');
const S = (msg) => ({ agent_id: 'A1-' + SID, agent_type: 'erp-frontend', last_assistant_message: msg });
x('LOOP with real proof', 'ACCEPT', S('DONE\nLOOP\n  Actions used: 9\n  Stopped: DONE\n  Proof: column visible on TEST'));
x('LOOP, proof "not run — needs deploy"', 'ACCEPT', S('LOOP\n  Actions used: 9\n  Stopped: DONE\n  Proof: not run — needs deploy'));
x('DONE but proof "none"', 'SENTBACK', S('LOOP\n  Actions used: 9\n  Stopped: DONE\n  Proof: none'));
x('DONE but proof empty', 'SENTBACK', S('LOOP\n  Actions used: 9\n  Stopped: DONE\n  Proof:'));
x('no LOOP block', 'SENTBACK', S('all done'));
x('BLOCKED with proof none (fine)', 'ACCEPT', S('LOOP\n  Actions used: 3\n  Stopped: BLOCKED\n  Proof: none'));
x('Explore helper, no LOOP (not checked)', 'ACCEPT', { agent_id: 'E', agent_type: 'Explore', last_assistant_message: 'x' });

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
