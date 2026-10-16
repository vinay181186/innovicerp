// The "Related To" chip — a link to the document a task hangs off. The task
// stores `linkedRef.navPage` as a path; the one page that needs a query
// string (QC Call Register, `?op=<jcOpId>`) is rendered as a typed Link with
// its search object, every other path goes straight through as `to`.

import type { TaskLinkedRef } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useCanOpen } from '@/components/shared/action-link';

const QC_CALL_PREFIX = '/qc-call-register?op=';
// Tasks raised from a CAPA before 2026-10-16 stored '/capa', a page that never
// existed; CAPA lives on the NC Register's CAPA tab.
const LEGACY_NAV: Record<string, string> = { '/capa': '/nc-register?tab=capa' };

export function RelatedRefLink({
  linkedRef,
  stopRowClick = false,
}: {
  linkedRef: TaskLinkedRef | null;
  /** Inside a clickable table row: keep the click from opening the row too. */
  stopRowClick?: boolean;
}): React.JSX.Element {
  const canOpen = useCanOpen();
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
  const raw = linkedRef.navPage;
  const nav = raw ? (LEGACY_NAV[raw] ?? raw) : raw;
  // ADR-234: no link to a page this user cannot open — the chip stays as text.
  if (!nav || !canOpen(nav)) return chip;
  const onClick = stopRowClick ? (e: React.MouseEvent) => e.stopPropagation() : undefined;
  if (nav.startsWith(QC_CALL_PREFIX)) {
    return (
      <Link
        to="/qc-call-register"
        // `op` is the register's "open this call" param. It is typed only on
        // the build that ships the QC-form popup; on an older build the route
        // simply drops the unknown key and opens the register. Untyped on
        // purpose so the task link works on both.
        search={{ op: nav.slice(QC_CALL_PREFIX.length) } as never}
        onClick={onClick}
        title={`Open ${linkedRef.display}`}
      >
        {chip}
      </Link>
    );
  }
  const q = nav.indexOf('?');
  if (q >= 0) {
    // A path with a query string ('/nc-register?tab=capa&capa=CAPA-0003'):
    // the router takes the query as a search object, not inside `to`.
    const search = Object.fromEntries(new URLSearchParams(nav.slice(q + 1)));
    return (
      <Link
        to={nav.slice(0, q)}
        search={search as never}
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
