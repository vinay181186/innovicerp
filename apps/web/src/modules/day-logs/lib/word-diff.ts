// Word diff between two Working On texts (ADR-255, Team Day Logs › person,
// Super Admin): "Changed from Entry Rev n-1:" (Working On) shows the newer text with the
// removed words struck out and the added words underlined. Pure — no React.
//
// Tokens are the words AND the whitespace between them (split on /(\s+)/),
// so line breaks and spacing come back exactly as typed. The longest common
// subsequence of the two token lists is kept as is; everything else is a
// removed (old only) or an added (new only) word. Whitespace is never marked
// — it is shown plain, so a deleted line break does not draw an empty box.

export type DiffKind = 'same' | 'del' | 'ins';

export interface DiffPart {
  kind: DiffKind;
  text: string;
}

/** Above this many token pairs the LCS table is not built (2000-char texts
 *  stay far below it); the whole old text is shown removed, the new added. */
const MAX_CELLS = 400_000;

function tokens(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

const isSpace = (t: string): boolean => !/\S/.test(t);

function push(out: DiffPart[], kind: DiffKind, text: string): void {
  // Whitespace is never marked: it joins the plain text.
  const k: DiffKind = isSpace(text) ? 'same' : kind;
  const last = out[out.length - 1];
  if (last && last.kind === k) last.text += text;
  else out.push({ kind: k, text });
}

/** `before` → `after` as plain / removed / added runs, in reading order. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  const n = a.length;
  const m = b.length;
  const out: DiffPart[] = [];
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (const t of a) push(out, 'del', t);
    for (const t of b) push(out, 'ins', t);
    return out;
  }
  // L[i][j] = LCS length of a[i..] and b[j..], flattened row by row.
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      L[i * w + j] =
        a[i] === b[j]
          ? L[(i + 1) * w + j + 1]! + 1
          : Math.max(L[(i + 1) * w + j]!, L[i * w + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(out, 'same', a[i]!);
      i += 1;
      j += 1;
    } else if (L[(i + 1) * w + j]! >= L[i * w + j + 1]!) {
      push(out, 'del', a[i]!);
      i += 1;
    } else {
      push(out, 'ins', b[j]!);
      j += 1;
    }
  }
  for (; i < n; i += 1) push(out, 'del', a[i]!);
  for (; j < m; j += 1) push(out, 'ins', b[j]!);
  return out;
}
