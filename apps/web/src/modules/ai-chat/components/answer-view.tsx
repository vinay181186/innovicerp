// One Ask ERP answer: text and tables (lib/answer-blocks.ts), document numbers in
// link blue, item codes mono bold dark (owner rule: the item code is THE main thing).
// Tables are the shared DataTable; columnAlign decides alignment from the heading
// and whether the column holds numbers (ADR-280).

import { useMemo } from 'react';
import { DataTable, type DataTableColumn } from '@/ui/data';
import {
  answerBlocks,
  type InlinePiece,
  inlinePieces,
  isDocNumber,
  isItemCodeHeading,
  isNumericColumn,
} from '../lib/answer-blocks';

const DOC_STYLE: React.CSSProperties = { color: 'var(--text-link)' };
const CODE_STYLE: React.CSSProperties = { color: 'var(--text)' };

function Piece({ p }: { p: InlinePiece }): React.JSX.Element {
  if (p.kind === 'doc')
    return (
      <span className="mono fw-700" style={DOC_STYLE}>
        {p.text}
      </span>
    );
  if (p.kind === 'code')
    return (
      <span className="mono fw-700" style={CODE_STYLE}>
        {p.text}
      </span>
    );
  if (p.kind === 'bold') return <strong>{p.text}</strong>;
  return <>{p.text}</>;
}

export function RichText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {inlinePieces(text).map((p, i) => (
        <Piece key={i} p={p} />
      ))}
    </>
  );
}

function Cell({ value, heading }: { value: string; heading: string }): React.JSX.Element {
  const plain = value.replace(/^`|`$/g, '');
  if (isItemCodeHeading(heading) && plain)
    return (
      <span className="mono fw-700" style={CODE_STYLE}>
        {plain}
      </span>
    );
  if (isDocNumber(plain))
    return (
      <span className="mono fw-700" style={DOC_STYLE}>
        {plain}
      </span>
    );
  return <RichText text={value} />;
}

function AnswerTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}): React.JSX.Element {
  const columns = useMemo<DataTableColumn<string[]>[]>(
    () =>
      headers.map((h, i) => ({
        id: `c${i}`,
        header: h,
        label: h,
        kind: isNumericColumn(rows, i) ? 'num' : 'text',
        nowrap: true,
        title: (row: string[]) => row[i] ?? '',
        render: (row: string[]) => <Cell value={row[i] ?? ''} heading={h} />,
      })),
    [headers, rows],
  );
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(_, i) => i}
      density="compact"
      sortFilter={false}
      autoWidth
      emptyText="No rows"
    />
  );
}

export function AnswerView({ answer }: { answer: string }): React.JSX.Element {
  const blocks = useMemo(() => answerBlocks(answer), [answer]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
      {blocks.map((b, i) =>
        b.kind === 'text' ? (
          <div key={i} style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--fs-sm)' }}>
            <RichText text={b.text} />
          </div>
        ) : (
          <AnswerTable key={i} headers={b.headers} rows={b.rows} />
        ),
      )}
    </div>
  );
}
