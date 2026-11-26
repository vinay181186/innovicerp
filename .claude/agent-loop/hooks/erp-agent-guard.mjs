// ERP agent guard — owner-approved locks for THE AGENT LOOP (2026-11-25).
// One script, four modes (argv[2]):
//   card   PreToolUse  Agent|Task  → refuse an ERP agent whose brief lacks the 5-line card
//   start  SubagentStart           → bind the brief's WORKTREE to the new agent id
//   action PreToolUse  Edit|Write|NotebookEdit|Bash (inside ERP agents only)
//                                  → block git writes, PROD, innovicerp, ~/.claude, other
//                                    agents' folders, files outside the briefed WORKTREE
//   fail   PostToolUseFailure      → same error a 2nd time: warn; 3rd time: tell it to stop
//   budget PostToolUse             → at 150 actions (deploy-gate 80) tell it to finish and report BUDGET
//                                    (maxTurns in each agent file hard-stops at 200 / 100)
// Only the 11 ERP agents are guarded; the main session and built-in helpers are untouched.
// Any internal error → allow (a broken guard must never stop real work). Blocks are logged
// to ~/.claude/agent-guard-log.tsv.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const HOME = os.homedir();
const STATE = path.join(HOME, '.claude', 'hooks', 'state');
const LOG = path.join(HOME, '.claude', 'agent-guard-log.tsv');
const ERP_ROOT = 'c:/innovic_projects/innovic-erp/';

const ERP_AGENTS = new Set([
  'bug-tracer', 'erp-backend', 'erp-deploy-gate', 'erp-frontend', 'erp-module-auditor',
  'erp-test', 'erp-work-orchestrator', 'form-behaviour', 'legacy-canonical-mapper',
  'legacy-page-refactor', 'page-registry-builder',
]);

// Folder each agent may EDIT, relative to its worktree root. null = anywhere in the worktree.
const OWN = {
  'erp-frontend': { allow: ['apps/web/'], deny: ['apps/web/e2e/'] },
  'legacy-page-refactor': { allow: ['apps/web/src/'] },
  'form-behaviour': { allow: ['apps/web/src/'] },
  'erp-backend': { allow: ['apps/api/'] },
  'erp-test': { allow: ['apps/web/e2e/'] },
  'page-registry-builder': { allow: ['docs/page-registry.yaml'] },
  'erp-work-orchestrator': { allow: ['docs/page-registry.yaml'] },
  'bug-tracer': { allow: null },
};

const CARD = ['GOAL', 'FILES', 'WORKTREE', 'DONE TEST', 'LIMITS'];
const CARD_TEMPLATE =
  'GOAL:      <one sentence>\nFILES:     <exact files / folders>\nWORKTREE:  <absolute path, never innovicerp>\n' +
  'DONE TEST: <how we know it works>\nLIMITS:    <what it must not touch>';

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase()
  .replace(/^\/([a-z])\//, '$1:/');
const isTemp = (p) => /\/appdata\/local\/temp\//.test(p) || p.startsWith('/tmp/');

function log(cols) {
  try { fs.appendFileSync(LOG, [new Date().toISOString(), ...cols].join('\t').replace(/\n/g, ' ') + '\n'); } catch {}
}
function ensureState() { try { fs.mkdirSync(STATE, { recursive: true }); } catch {} }
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function cleanup() {
  try {
    const cut = Date.now() - 2 * 86400e3;
    for (const f of fs.readdirSync(STATE)) {
      const p = path.join(STATE, f);
      if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p);
    }
  } catch {}
}

function deny(input, reason, rule) {
  log(['BLOCK', input.agent_type || 'main', rule, input.tool_name || '', reason.slice(0, 160), input.session_id || '']);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// ---------- card ----------
function cardWorktree(prompt) {
  const m = prompt.match(/^\s*\**WORKTREE\**\s*:\s*\**\s*`?([^`\n*]+)`?/im);
  return m ? m[1].trim() : '';
}
function modeCard(input) {
  const ti = input.tool_input || {};
  const type = ti.subagent_type || '';
  if (!ERP_AGENTS.has(type)) return;
  const prompt = String(ti.prompt || '');
  const missing = CARD.filter((k) => !new RegExp(`^\\s*[-*>]*\\s*\\**${k.replace(' ', '\\s+')}\\**\\s*:`, 'im').test(prompt));
  if (missing.length) {
    deny(input, `ERP agent "${type}" not started: the brief is missing the task-card line(s) ${missing.join(', ')}. ` +
      `Start the brief with all five lines (owner rule, THE AGENT LOOP):\n${CARD_TEMPLATE}`, 'CARD');
  }
  const wt = norm(cardWorktree(prompt)).replace(/\/$/, '');
  if (/\/innovicerp(\/|$)/.test(wt + '/')) {
    deny(input, `ERP agent "${type}" not started: WORKTREE is innovicerp (the main checkout). Use a wt-* worktree on test.`, 'CARD-WT');
  }
  ensureState();
  const f = path.join(STATE, `brief-${input.session_id}-${type}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
  try { fs.writeFileSync(f, JSON.stringify({ worktree: wt, type, at: Date.now() })); } catch {}
  log(['CARD-OK', type, wt, input.session_id || '']);
}

// ---------- start ----------
function modeStart(input) {
  const type = input.agent_type || '';
  if (!ERP_AGENTS.has(type) || !input.agent_id) return;
  ensureState(); cleanup();
  let files = [];
  try {
    files = fs.readdirSync(STATE).filter((f) => f.startsWith(`brief-${input.session_id}-${type}-`)).sort();
  } catch {}
  for (const f of files) {
    try {
      fs.renameSync(path.join(STATE, f), path.join(STATE, `bind-${input.agent_id}.json`)); // atomic claim
      return;
    } catch { /* another agent claimed it */ }
  }
}

// ---------- action ----------
const GIT_WRITE = /\bgit\b(?:\s+-[cC]\s+\S+)*\s+(commit|push|reset|checkout|switch|stash|merge|rebase|add|restore|clean|cherry-pick|revert|tag|am|apply|rm|mv|worktree\s+(?:add|remove|move)|branch\s+-[dDmMfc])\b/;
const PROD = [
  [/DB_TARGET\s*=\s*['"]?PROD/i, 'DB_TARGET=PROD'],
  [/ctbrlcdwfddhlscnoyos/i, 'the PRODUCTION Supabase project'],
  [/drizzle-kit\s+(migrate|push|drop|up)/i, 'drizzle-kit migrate/push'],
  [/\bdb:(push|seed|migrate|reset)\b/i, 'db:push / seed / migrate'],
  [/release-prod\.sh/i, 'the PROD release script'],
];
const SHELL_WRITE = /(\bsed\s+-i|\s>>?\s*\S|\btee\b|\bcp\b|\bmv\b|\brm\b|\bSet-Content\b|\bOut-File\b|\bAdd-Content\b|\bRemove-Item\b|\bNew-Item\b|writeFileSync|\bperl\s+-pi)/i;

function checkPath(input, raw) {
  const type = input.agent_type;
  const p = norm(raw);
  if (!p) return;
  if (isTemp(p)) return;
  if (p.includes('/innovicerp/') || p.endsWith('/innovicerp')) deny(input, `Blocked: ${type} may not change files in innovicerp (the main checkout, other terminal). Work in your WORKTREE.`, 'INNOVICERP');
  if (p.startsWith(norm(HOME) + '/.claude/')) deny(input, `Blocked: ${type} may not change Claude settings, hooks or agent files (${raw}).`, 'CLAUDE-DIR');
  if (!p.startsWith(ERP_ROOT)) deny(input, `Blocked: ${raw} is outside the ERP workspace. Agents edit only inside their WORKTREE (or a temp folder).`, 'OUTSIDE');

  const bind = readJson(path.join(STATE, `bind-${input.agent_id}.json`), null);
  let root = bind && bind.worktree ? bind.worktree + '/' : '';
  if (root && !p.startsWith(root)) deny(input, `Blocked: ${raw} is outside your WORKTREE (${bind.worktree}). Edit only inside the worktree named in your brief.`, 'WORKTREE');
  if (!root) { const m = p.match(/^c:\/innovic_projects\/innovic-erp\/[^/]+\//); root = m ? m[0] : ERP_ROOT; }
  const rel = p.slice(root.length);
  const own = OWN[type];
  if (!own) deny(input, `Blocked: ${type} is a read-only agent and may not edit files.`, 'READONLY');
  if (own.allow && !own.allow.some((a) => rel.startsWith(a))) deny(input, `Blocked: ${type} may edit only ${own.allow.join(', ')} (folder ownership). ${rel} belongs to another agent — STOP and report the exact edit you would make.`, 'OWNERSHIP');
  if (own.deny && own.deny.some((a) => rel.startsWith(a))) deny(input, `Blocked: ${rel} is owned by another agent (folder ownership). STOP and report the exact edit you would make.`, 'OWNERSHIP');
}

function modeAction(input) {
  const type = input.agent_type || '';
  if (!ERP_AGENTS.has(type)) return; // main session + built-in helpers: not guarded
  const ti = input.tool_input || {};
  ensureState();
  // count real actions per agent (logged at SubagentStop)
  const cf = path.join(STATE, `count-${input.agent_id}.json`);
  const c = readJson(cf, { n: 0 }); c.n++; try { fs.writeFileSync(cf, JSON.stringify(c)); } catch {}

  if (input.tool_name === 'Bash' || input.tool_name === 'PowerShell') {
    const cmd = String(ti.command || '');
    if (GIT_WRITE.test(cmd)) deny(input, `Blocked: agents never run git that changes the repo (${cmd.match(GIT_WRITE)[0]}). Leave the files changed and say in your report what the main session must commit.`, 'GIT');
    if (/\bgit\b[^|;&]*\bpush\b[^|;&]*\bmain\b/.test(cmd)) deny(input, 'Blocked: pushing to main. Production goes only through release/release-prod.sh, run by the main session.', 'PROD');
    for (const [re, what] of PROD) if (re.test(cmd)) deny(input, `Blocked: ${what} — agents never touch PRODUCTION or run schema push/seed. TEST migrations go through apply-sql.ts without DB_TARGET=PROD.`, 'PROD');
    if (/innovicerp/i.test(cmd) && SHELL_WRITE.test(cmd)) deny(input, 'Blocked: shell command writes into innovicerp (the main checkout). Work in your WORKTREE.', 'INNOVICERP');
    if (/\.claude[\\/](settings|hooks|agents|CLAUDE\.md)/i.test(cmd) && SHELL_WRITE.test(cmd)) deny(input, 'Blocked: agents may not change Claude settings, hooks or agent files.', 'CLAUDE-DIR');
    return;
  }
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(input.tool_name)) {
    checkPath(input, ti.file_path || ti.notebook_path || '');
  }
}

// ---------- budget ----------
const SOFT = { 'erp-deploy-gate': 80 };
function modeBudget(input) {
  const type = input.agent_type || '';
  if (!ERP_AGENTS.has(type) || !input.agent_id) return;
  const soft = SOFT[type] || 150;
  const n = (readJson(path.join(STATE, `count-${input.agent_id}.json`), { n: 0 }).n) || 0;
  if (n < soft || (n - soft) % 10 !== 0) return; // at the limit, then every 10 actions after
  if (n === soft) log(['BUDGET', type, String(n), input.session_id || '']);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse',
    additionalContext: `THE AGENT LOOP: BUDGET reached — ${n} actions used (limit ${soft}). Finish only the step you are on, ` +
      'then write your final report now: what is DONE, what is NOT DONE, and end with the LOOP block (Stopped: BUDGET). ' +
      'The main session will continue the rest.' } }));
}

// ---------- fail ----------
function modeFail(input) {
  const type = input.agent_type || '';
  if (!ERP_AGENTS.has(type) || !input.agent_id) return;
  ensureState();
  const sig = String(input.error || '').replace(/\d+(\.\d+)?\s*ms/g, '').replace(/0x[0-9a-f]+/gi, '').slice(0, 300);
  const key = crypto.createHash('sha1').update(input.tool_name + '|' + sig).digest('hex').slice(0, 12);
  const f = path.join(STATE, `fail-${input.agent_id}.json`);
  const s = readJson(f, {}); s[key] = (s[key] || 0) + 1;
  try { fs.writeFileSync(f, JSON.stringify(s)); } catch {}
  const n = s[key];
  let msg = '';
  if (n === 2) msg = 'THE AGENT LOOP: this is the SAME error a 2nd time. Change your approach now — do not repeat the same action.';
  if (n >= 3) {
    msg = `THE AGENT LOOP: SAME ERROR ${n} times. STOP now. Do not try again. Write your final report with "Stopped: SAME ERROR", the error text, and what you tried.`;
    log(['SAME-ERROR', type, String(n), input.tool_name, sig.slice(0, 120), input.session_id || '']);
  }
  if (msg) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: msg } }));
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
  try {
    const mode = process.argv[2];
    if (mode === 'card') modeCard(input);
    else if (mode === 'start') modeStart(input);
    else if (mode === 'action') modeAction(input);
    else if (mode === 'fail') modeFail(input);
    else if (mode === 'budget') modeBudget(input);
  } catch (e) {
    log(['GUARD-ERROR', input.agent_type || '', String(e && e.message).slice(0, 160)]);
  }
  process.exit(0);
});
