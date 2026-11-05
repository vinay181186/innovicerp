import { Button, Panel, StatusBadge } from '@innovic/web';

export const WithActions = () => (
  <Panel
    title="SO Details"
    actions={
      <>
        <StatusBadge kind="so" status="open" />
        <Button size="sm" variant="ghost">Print</Button>
      </>
    }
  >
    IN-SO-00123 · Sample Engineering Pvt Ltd · SO Date 03-11-2026 · Client PO No. PO-7781
  </Panel>
);

export const TitleOnly = () => (
  <Panel title="Dispatch Remarks">
    Pack BRKT-101/A in wooden crates, 20 pieces per crate. Test certificate to go with the first lot.
  </Panel>
);

export const Accented = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Panel title="IN-SO-00123 — On track" accent="var(--blue)">
      Due 28-11-2026 · 60 of 100 pieces dispatched
    </Panel>
    <Panel title="IN-SO-00118 — Late" accent="var(--red2)">
      Was due 30-10-2026 · 25 pieces still pending
    </Panel>
    <Panel title="IN-SO-00097 — Completed" accent="var(--green)">
      All 40 pieces dispatched on 21-10-2026
    </Panel>
  </div>
);
