// Validates the subagent definitions in .claude/agents/.
//
// WHY THIS EXISTS. A subagent whose frontmatter does not parse is skipped
// SILENTLY -- no error, no warning, it simply is not in the agent list. That is
// indistinguishable from an agent you never called, so a broken one can sit
// there for weeks. `erp-module-auditor` did exactly that: its description held
// an unquoted `repeat: `, a colon-then-space ends a YAML scalar early, the
// frontmatter failed to parse, and all 301 lines of it never once loaded.
//
// Deliberately dependency-free: it parses only the few frontmatter keys that
// decide whether a file loads, rather than pulling in a YAML library.
//
// Run:  node scripts/check-agents.mjs
// Exits 1 on the first problem found, so it can gate a commit or a CI job.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.claude/agents';

// Files starting with `_` are shared includes an agent reads at runtime
// (_house-rules.md), not agents. They carry no frontmatter by design.
const isInclude = (f) => f.startsWith('_');

const problems = [];
const loaded = [];

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.md')).sort()) {
  if (isInclude(file)) continue;
  const path = join(DIR, file);
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const fail = (msg) => problems.push(`${path}: ${msg}`);

  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) {
    fail('no frontmatter — the file will not load as an agent');
    continue;
  }

  const fields = new Map();
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const at = line.indexOf(':');
    if (at === -1) {
      fail(`frontmatter line is not \`key: value\` -> ${line.trim()}`);
      continue;
    }
    fields.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }

  const name = fields.get('name');
  const expected = file.replace(/\.md$/, '');
  if (!name) fail('no `name:` — the agent cannot be addressed');
  else if (name !== expected) fail(`name is "${name}" but the file is "${file}"`);

  const description = fields.get('description');
  if (!description) {
    fail('no `description:` — the model cannot tell when to pick this agent');
  } else {
    const quoted = /^".*"$/s.test(description) || /^'.*'$/s.test(description);
    // THE BUG THIS SCRIPT WAS WRITTEN FOR. In an unquoted YAML scalar a
    // colon followed by a space starts a nested mapping, the parse fails,
    // and the whole agent disappears without a word.
    if (!quoted && /\S: /.test(description)) {
      const at = description.indexOf(': ', description.search(/\S: /));
      fail(
        'description contains an unquoted ": " — this BREAKS the YAML and the ' +
          `agent will not load. Wrap it in double quotes. Near: ...${description.slice(Math.max(0, at - 40), at + 20)}...`,
      );
    }
  }

  if (!fields.has('tools')) {
    // Not fatal — an agent with no `tools:` inherits every tool. Worth saying
    // out loud, because it is usually an omission rather than a decision.
    console.warn(`  note  ${path}: no \`tools:\` — this agent inherits ALL tools`);
  }

  if (name === expected && description) loaded.push(name);
}

// The shared includes are not agents, but four agents stop dead without
// _house-rules.md, so its absence is a failure too.
for (const required of ['_house-rules.md']) {
  try {
    readFileSync(join(DIR, required), 'utf8');
  } catch {
    problems.push(`${join(DIR, required)}: missing — agents that read it will stop`);
  }
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) in ${DIR}:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`${loaded.length} agent definitions OK: ${loaded.join(', ')}`);
