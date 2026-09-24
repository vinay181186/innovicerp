// Admin/Manager home — composed only from canonical DS blocks (WorkList, StatStrip, StatRow, AttentionList, QuickLinks).
function Dashboard({ go }) {
  const { StatStrip, Panel, WorkList, StatRow, AttentionList, QuickLinks, Button } = window.InnovicERPDesignSystem_4a2115;
  const [mode, setMode] = useState('home');
  return <div style={{ paddingTop: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
      <div><h1 className="section-hdr" style={{ margin: 0 }}>Good Morning, Vinay</h1>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)' }}>Wednesday, 23 September 2026 · <b style={{ color: 'var(--text2)' }}>admin</b></div></div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Button variant="ghost" icon={<Icon name="bell" size={13} />} onClick={() => setMode(mode === 'alerts' ? 'home' : 'alerts')}>{mode === 'alerts' ? 'Overview' : 'Alerts'}</Button>
        <Button variant="ghost" icon={<Icon name="package" size={13} />}>Widgets</Button>
        <Button variant="ghost" icon={<Icon name="settings" size={13} />}>Customize</Button>
        <Button variant="ghost" iconOnly title="Refresh" icon={<Icon name="refresh-cw" size={13} />} />
      </div>
    </div>
    <WorkList items={[
      { severity: 'critical', icon: '⚠️', title: 'NC-0214 awaiting disposition', detail: 'JC-0917 · Pinion Shaft · 4 pcs rejected at OD grinding', age: 5, action: 'Dispose' },
      { severity: 'warn', icon: '📄', title: 'PR-26-0311 pending approval', detail: 'EN8 round bar Ø45 × 3m · 12 nos · raised by Store', age: 2, action: 'Approve' },
      { severity: 'warn', icon: '📦', title: 'BOM pending for IN-SO-26-0136', detail: 'Thermax Ltd · Equipment · 2 sets', age: 1, action: 'Create BOM' },
      { severity: 'info', icon: '🔬', title: 'QC call — JC-0922 Op 30', detail: 'Spur Gear 42T · first-off inspection', age: 0, action: 'Inspect' },
    ]} />
    <StatStrip items={[
      { key: 'so', label: 'Active SOs', count: 23, color: 'var(--sig-info)', sub: <span style={{ color: 'var(--sig-critical)', fontWeight: 700 }}>2 overdue</span>, onClick: () => go('so') },
      { key: 'jc', label: 'Open Job Cards', count: 41, color: 'var(--dept-production)', sub: <span style={{ color: 'var(--sig-critical)', fontWeight: 700 }}>3 overdue</span>, onClick: () => go('ops') },
      { key: 'm', label: 'Machines Running', count: '11/14', color: 'var(--dept-production)', sub: '79% utilization', onClick: () => go('ops') },
      { key: 'o', label: "Today's Output", count: '386 pcs', color: 'var(--sig-ok)', sub: 'Completed across all ops', onClick: () => go('ops') },
    ]} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginBottom: 12 }}>
      <Panel title="Today" style={{ margin: 0 }} bodyPadding="12px 16px">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <StatRow icon="📥" label="GRNs received" value={4} /><StatRow icon="🚚" label="Dispatches" value={2} />
          <StatRow icon="▶" label="Ops running" value={11} onClick={() => go('ops')} /><StatRow icon="✅" label="Ops completed" value={27} />
        </div>
      </Panel>
      <Panel title="Needs Attention" style={{ margin: 0 }} bodyPadding={0}>
        <AttentionList items={[{ icon: '🔴', label: '2 SOs overdue', severity: 'critical', onClick: () => go('so') }, { icon: '⏱', label: '3 job cards past target date', severity: 'warn' }, { icon: '📥', label: '1 GRN awaiting incoming QC', severity: 'info' }]} />
      </Panel>
    </div>
    <Panel bodyPadding="12px 16px">
      <QuickLinks links={[{ icon: '📋', label: 'SO Master', color: 'var(--dept-sales)', onClick: () => go('so') }, { icon: '✚', label: 'Op Entry', color: 'var(--dept-production)', onClick: () => go('ops') }, { icon: '📥', label: 'GRN', color: 'var(--dept-store)' }, { icon: '📋', label: 'Purchase Orders', color: 'var(--dept-purchase)', onClick: () => go('po') }, { icon: '🔬', label: 'QC Command Center', color: 'var(--dept-qc)' }, { icon: '📋', label: 'Task Board', color: 'var(--dept-tasks)', onClick: () => go('tasks') }]} />
    </Panel>
  </div>;
}
window.Dashboard = Dashboard;
