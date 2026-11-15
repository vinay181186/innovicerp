// Ask ERP (ADR-293): the server sends plain text, and lists as GitHub-style pipe
// tables. This splits an answer into text blocks and table blocks, and a line of
// text into plain / bold / item-code / document-number pieces. Pure functions —
// no markdown library (none is installed, and none is needed for this much).

export type AnswerBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

export type InlinePiece =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  /** `code` in backticks — the model is told to write item codes this way. */
  | { kind: 'code'; text: string }
  /** A document number: IN-SO-00417, IN-PO-26-00012, SO-1234 … */
  | { kind: 'doc'; text: string };

const SEPARATOR_CELL = /^:?-{3,}:?$/;

/** `| a | b |` → ['a', 'b']. An escaped `\|` stays inside its cell. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function isRowLine(line: string): boolean {
  return line.includes('|') && line.trim().length > 0;
}

function isSeparator(line: string, width: number): boolean {
  if (!isRowLine(line)) return false;
  const cells = splitRow(line);
  return cells.length === width && cells.every((c) => SEPARATOR_CELL.test(c));
}

export function answerBlocks(answer: string): AnswerBlock[] {
  const lines = answer.replace(/\r\n?/g, '\n').split('\n');
  const blocks: AnswerBlock[] = [];
  let text: string[] = [];
  const flushText = (): void => {
    const joined = text.join('\n').replace(/^\n+|\n+$/g, '');
    if (joined.trim()) blocks.push({ kind: 'text', text: joined });
    text = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const next = lines[i + 1];
    const headers = isRowLine(line) ? splitRow(line) : [];
    if (headers.length > 0 && next !== undefined && isSeparator(next, headers.length)) {
      flushText();
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isRowLine(lines[i] ?? '')) {
        const cells = splitRow(lines[i] ?? '');
        rows.push(headers.map((_, c) => cells[c] ?? ''));
        i += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }
    text.push(line);
    i += 1;
  }
  flushText();
  return blocks;
}

const DOC_NO = String.raw`\bIN-[A-Z]{2,6}-(?:\d{2}-)?\d{3,6}\b|\b(?:SO|PO|JC|NC|PRO)-\d{3,6}\b`;
const INLINE = new RegExp(String.raw`\*\*([^*]+)\*\*|` + '`([^`]+)`|' + `(${DOC_NO})`, 'g');
const WHOLE_DOC = new RegExp(`^(?:${DOC_NO})$`);

/** Is this whole cell a document number? */
export function isDocNumber(value: string): boolean {
  return WHOLE_DOC.test(value.trim());
}

export function inlinePieces(line: string): InlinePiece[] {
  const out: InlinePiece[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    const start = m.index;
    if (start > at) out.push({ kind: 'text', text: line.slice(at, start) });
    if (m[1] !== undefined) out.push({ kind: 'bold', text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', text: m[2] });
    else out.push({ kind: 'doc', text: m[0] });
    at = start + m[0].length;
  }
  if (at < line.length) out.push({ kind: 'text', text: line.slice(at) });
  return out;
}

/** A column every filled cell of which is a plain number (qty, count, amount). */
export function isNumericColumn(rows: string[][], col: number): boolean {
  const cells = rows.map((r) => (r[col] ?? '').trim()).filter((c) => c !== '' && c !== '-');
  return cells.length > 0 && cells.every((c) => /^(?:₹\s?)?-?[\d,]+(?:\.\d+)?%?$/.test(c));
}

/** A heading that names an item code — its cells render mono bold dark. */
export function isItemCodeHeading(heading: string): boolean {
  return /\b(item|part)\s*(code|no\.?)(?=\s|$)|^item$/i.test(heading.trim());
}
