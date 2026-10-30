// Team Day Logs › a person — Super Admin's LEFT pane under an entry (ADR-255,
// ADR-256): "Every version (newest first)". One Entry Rev per changed save of
// ANY field (Working On, Start Time, Stop Time, SO / JWSO). Each version: an
// "Entry Rev n" badge, when it was saved, the entry as saved on one line
// (Start Time – Stop Time · SO / JWSO · Working On), and for n > 0 "Changed
// from Entry Rev n-1:" listing only what changed — times compared on HH:MM,
// SO / JWSO on id, Working On as a word diff (removed struck out, added
// underlined).

import type { DayLogEntryRevision } from '@innovic/shared';
import { fmt12 } from '@innovic/shared';
import { istStamp } from '../lib/format';
import { wordDiff } from '../lib/word-diff';

function Diff({ before, after }: { before: string; after: string }): React.JSX.Element {
  return (
    <>
      {wordDiff(before, after).map((p, i) =>
        p.kind === 'del' ? (
          <del key={i}>{p.text}</del>
        ) : p.kind === 'ins' ? (
          <ins key={i}>{p.text}</ins>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** "HH:MM" or "HH:MM:SS" → "HH:MM", so seconds alone are never a change. */
function hm(t: string | null): string | null {
  return t ? t.slice(0, 5) : null;
}

/** Stop Time as shown: none = still Open. */
function stopText(t: string | null): string {
  return t ? fmt12(t) : 'Open';
}

function orderText(o: DayLogEntryRevision['order']): string {
  return o?.code ?? '—';
}

/** Start Time / Stop Time / SO / JWSO facts that differ, as "Label old → new". */
function spanChanges(
  b: DayLogEntryRevision,
  a: DayLogEntryRevision,
): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  // A version saved before ADR-256 never kept its times / SO — nothing to compare.
  if (!b.fromTime) return out;
  if (hm(b.fromTime) !== hm(a.fromTime)) {
    out.push({ label: 'Start Time', from: fmt12(b.fromTime), to: fmt12(a.fromTime) });
  }
  if (hm(b.toTime) !== hm(a.toTime)) {
    out.push({ label: 'Stop Time', from: stopText(b.toTime), to: stopText(a.toTime) });
  }
  if ((b.order?.id ?? null) !== (a.order?.id ?? null)) {
    out.push({ label: 'SO / JWSO', from: orderText(b.order), to: orderText(a.order) });
  }
  return out;
}

function Changed({
  prev,
  r,
}: {
  prev: DayLogEntryRevision;
  r: DayLogEntryRevision;
}): React.JSX.Element {
  const spans = spanChanges(prev, r);
  const textChanged = prev.description !== r.description;
  return (
    <div className="dl-rev-d">
      <span className="dl-rev-dl">Changed from Entry Rev {r.entryRevNo - 1}:</span>
      {spans.map((c) => (
        <div key={c.label}>
          <span className="dl-rev-dl">{c.label}</span> <span className="mono">{c.from}</span> →{' '}
          <span className="mono">{c.to}</span>
        </div>
      ))}
      {textChanged ? (
        <div>
          <span className="dl-rev-dl">Working On:</span>{' '}
          <Diff before={prev.description} after={r.description} />
        </div>
      ) : null}
      {spans.length === 0 && !textChanged ? <div className="text3">No change.</div> : null}
    </div>
  );
}

export function PersonRevisions({
  revisions,
}: {
  /** Newest first (as the server sends them). */
  revisions: readonly DayLogEntryRevision[];
}): React.JSX.Element {
  const byNo = new Map(revisions.map((r) => [r.entryRevNo, r]));
  const newest = revisions[0]?.entryRevNo;
  return (
    <div className="dl-pane">
      <div className="dl-sec-h">Every version (newest first)</div>
      {revisions.length === 0 ? <div className="text3 dl-small">No saved version.</div> : null}
      <ol className="dl-revs">
        {revisions.map((r) => {
          const prev = byNo.get(r.entryRevNo - 1);
          const at = istStamp(r.savedAt);
          return (
            <li key={r.entryRevNo} className="dl-rev">
              <div className="dl-rev-h">
                <span className={`badge ${r.entryRevNo === newest ? 'b-blue' : 'b-grey'}`}>
                  Entry Rev {r.entryRevNo}
                </span>
                <span className="mono">
                  {at.date} · {at.time}
                </span>
              </div>
              <div className="dl-full">
                {r.fromTime ? (
                  <>
                    <span className="mono">
                      {fmt12(r.fromTime)} – {stopText(r.toTime)}
                    </span>
                    {' · '}
                    <span className="mono">{orderText(r.order)}</span>
                  </>
                ) : (
                  <span className="text3">Times / SO not recorded</span>
                )}
                {' · '}
                {r.description}
              </div>
              {r.entryRevNo > 0 && prev ? <Changed prev={prev} r={r} /> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
