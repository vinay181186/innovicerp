// SubagentStop hook — owner rule 2026-11-24 (THE AGENT LOOP).
// Every ERP agent report must end with the LOOP block. If it is missing, the agent is sent
// back once to add it; a second miss is let through with a warning. Every result is logged to
// ~/.claude/agent-loop-log.tsv so the follow-up check can count them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ERP_AGENTS = new Set([
  'bug-tracer', 'erp-backend', 'erp-deploy-gate', 'erp-frontend', 'erp-module-auditor',
  'erp-test', 'erp-work-orchestrator', 'form-behaviour', 'legacy-canonical-mapper',
  'legacy-page-refactor', 'page-registry-builder',
]);

function lastAssistantText(file) {
  let last = '';
  let readRules = false;
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      if (line.includes('_house-rules.md')) readRules = true;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const m = o.message || {};
      if (m.role !== 'assistant') continue;
      const c = m.content;
      // The final report may come as plain text or inside the SubagentHandback tool call.
      const t = typeof c === 'string' ? c
        : (c || []).map((x) => (x && x.type === 'text' ? x.text
          : x && x.type === 'tool_use' && x.name === 'SubagentHandback' ? String(x.input?.message || '')
          : '')).join('\n');
      if (t.trim()) last = t;
    }
  } catch { /* unreadable transcript → treat as unknown */ }
  return { last, readRules };
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

  const type = input.agent_type || '';
  if (type && !ERP_AGENTS.has(type)) process.exit(0);

  const tPath = input.agent_transcript_path || '';
  const fromFile = tPath ? lastAssistantText(tPath) : { last: '', readRules: false };
  if (!type && !fromFile.readRules) process.exit(0); // not an ERP agent

  const text = input.last_assistant_message || fromFile.last;
  if (!text) process.exit(0);
  const hasLoop = /(^|\n)\s*`{0,3}\s*LOOP\s*\n[\s\S]*Actions used:/.test(text);
  const loopPart = hasLoop ? text.slice(text.search(/(^|\n)\s*`{0,3}\s*LOOP\s*\n/)) : '';
  const stopped = (loopPart.match(/Stopped:\s*([^\n]*)/) || [])[1] || '';
  const proof = ((loopPart.match(/Proof:\s*([^\n]*)/) || [])[1] || '').trim();
  const reported = (loopPart.match(/Actions used:\s*(\d+)/) || [])[1] || '';
  // DONE needs a real proof: empty, "none", "-" or the template placeholder is not proof.
  const proofEmpty = !proof || /^(none|n\/?a|-+|—|<.*>|tbd)\.?$/i.test(proof);
  const doneNoProof = hasLoop && /^\s*DONE\b/i.test(stopped) && proofEmpty;
  const ok = hasLoop && !doneNoProof;

  // Real action count, kept by erp-agent-guard.mjs (agents tend to under-report it).
  let real = '';
  try {
    const cf = path.join(os.homedir(), '.claude', 'hooks', 'state', `count-${input.agent_id}.json`);
    real = String(JSON.parse(fs.readFileSync(cf, 'utf8')).n || '');
  } catch { /* no count yet */ }

  try {
    const log = path.join(os.homedir(), '.claude', 'agent-loop-log.tsv');
    const row = [new Date().toISOString(), type || '?', ok ? 'LOOP' : doneNoProof ? 'NO-PROOF' : 'MISSING',
      input.stop_hook_active ? 'retry' : 'first', input.session_id || '',
      `reported=${reported}`, `real=${real}`, `stopped=${stopped.trim().slice(0, 20)}`].join('\t');
    fs.appendFileSync(log, row + '\n');
  } catch { /* logging never blocks */ }

  if (ok) process.exit(0);
  if (doneNoProof && !input.stop_hook_active) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: 'Your LOOP block says "Stopped: DONE" but "Proof:" is empty. "DONE" without proof is not done. ' +
        'Do not redo the work. Either write the DONE TEST result you actually saw, or write ' +
        '"Proof: not run — needs <who>" and change Stopped to say what is still open. Then print the final report again.',
    }));
    process.exit(0);
  }
  if (input.stop_hook_active) {
    process.stdout.write(JSON.stringify({
      systemMessage: `Agent ${type || ''} finished WITHOUT the LOOP block (after one reminder).`,
    }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: 'Your final report is missing the LOOP block (STEP 0b / _house-rules.md → THE AGENT LOOP). ' +
      'Do not redo any work. Print your final report again and end it with:\n' +
      'LOOP\n  Actions used:   <n>\n  Retries:        <n> — <what>\n' +
      '  Stopped:        DONE / BLOCKED / SAME ERROR / BUDGET / UNCLEAR\n' +
      '  Proof:          <DONE TEST result or "not run — needs <who>">\n  New rule found: <... or "none">',
  }));
});
