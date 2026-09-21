// The "Related To" chip — a link to the document a task hangs off. The task
// stores `linkedRef.navPage` as a path; the one page that needs a query
// string (QC Call Register, `?op=<jcOpId>`) is rendered as a typed Link with
// its search object, every other path goes straight through as `to`.

import type { TaskLinkedRef } from '@innovic/shared';
import { Link } from '@tanstack/react-router';

const QC_CALL_PREFIX = '/qc-call-register?op=';

export function RelatedRefLink({
  linkedRef,
  stopRowClick = false,
}: {
  linkedRef: TaskLinkedRef | null;
  /** Inside a clickable table row: keep the click from opening the row too. */
  stopRowClick?: boolean;
}): React.JSX.Element {
  if (!linkedRef?.display) return <span className="text3">—</span>;
  const chip = (
    <span
      className="task-linked-ref"
      style={{ marginLeft: 0 }}
      title={`Linked to ${linkedRef.display}`}
    >
      🔗 {linkedRef.display}
    </span>
  );
  const nav = linkedRef.navPage;
  if (!nav) return chip;
  const onClick = stopRowClick ? (e: React.MouseEvent) => e.stopPropagation() : undefined;
  if (nav.startsWith(QC_CALL_PREFIX)) {
    return (
      <Link
        to="/qc-call-register"
        search={{ op: nav.slice(QC_CALL_PREFIX.length) }}
        onClick={onClick}
        title={`Open ${linkedRef.display}`}
      >
        {chip}
      </Link>
    );
  }
  return (
    <Link to={nav} onClick={onClick} title={`Open ${linkedRef.display}`}>
      {chip}
    </Link>
  );
}
