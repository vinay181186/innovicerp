// ADR-293 — the AI chat's allow-list is exactly seven read tools, and nothing
// in the module imports a service that writes. Static checks on the source, so
// no database and no env are needed: `pnpm --filter @innovic/api test:unit`.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AI_CHAT_TOOL_NAMES } from './tool-names';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(join(here, f), 'utf8');

function sourceFiles(dir: string): string[] {
  return readdirSync(join(here, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return sourceFiles(rel);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [rel] : [];
  });
}

/** Every name imported from a module outside ai-chat. */
function importedNames(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.\.\/[^']+)'/g)) {
    for (const n of (m[1] ?? '').split(',')) {
      const name = n
        .replace(/^\s*type\s+/, '')
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe('AI chat tool allow-list', () => {
  it('has exactly the seven read tools', () => {
    expect([...AI_CHAT_TOOL_NAMES].sort()).toEqual(
      [
        'get_document',
        'item_stock',
        'list_documents',
        'list_lines',
        'list_reports',
        'run_report',
        'search_documents',
      ].sort(),
    );
  });

  it('tools.ts defines each of them, typed against the list', () => {
    const src = read('tools.ts');
    expect(src).toContain('satisfies Record<AiChatToolName, AiTool>');
    for (const name of AI_CHAT_TOOL_NAMES) expect(src).toContain(`name: '${name}'`);
  });

  it('imports no create / update / delete / approve / close / cancel / post service', () => {
    const banned =
      /^(create|update|delete|approve|close|cancel|post|adjust|raise|set|save|reject)/i;
    for (const file of sourceFiles('')) {
      const bad = importedNames(read(file)).filter((n) => banned.test(n));
      expect({ file, bad }).toEqual({ file, bad: [] });
    }
  });
});
