// Team Day Logs › a person — Super Admin's LEFT pane under an entry (ADR-255):
// "Working On — every version (newest first)". Each revision: a "Text Rev n"
// badge, when it was saved, the full text, and for n > 0 "Changed from Text
// Rev n-1:" with the words removed (struck out) and added (underlined).

import type { DayLogTextRevision } from '@innovic/shared';
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

export function PersonRevisions({
  revisions,
}: {
  /** Newest first (as the server sends them). */
  revisions: readonly DayLogTextRevision[];
}): React.JSX.Element {
  const byNo = new Map(revisions.map((r) => [r.textRevNo, r]));
  const newest = revisions[0]?.textRevNo;
  return (
    <div className="dl-pane">
      <div className="dl-sec-h">Working On — every version (newest first)</div>
      {revisions.length === 0 ? <div className="text3 dl-small">No saved text.</div> : null}
      <ol className="dl-revs">
        {revisions.map((r) => {
          const prev = byNo.get(r.textRevNo - 1);
          const at = istStamp(r.savedAt);
          return (
            <li key={r.textRevNo} className="dl-rev">
              <div className="dl-rev-h">
                <span className={`badge ${r.textRevNo === newest ? 'b-blue' : 'b-grey'}`}>
                  Text Rev {r.textRevNo}
                </span>
                <span className="mono">
                  {at.date} · {at.time}
                </span>
              </div>
              <div className="dl-full">{r.description}</div>
              {r.textRevNo > 0 && prev ? (
                <div className="dl-rev-d">
                  <span className="dl-rev-dl">Changed from Text Rev {r.textRevNo - 1}:</span>{' '}
                  <Diff before={prev.description} after={r.description} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
