// SO / WO Orders — composed from canonical DS blocks: ListHeader, StatusPills, ViewToggle, DataTable(sheet), RowActions, DocCard, LinesPanel, QtyStrip, ListFooter, PageState, ConfirmDialog.
function LineItems({ so, go }) {
  const { StatusBadge, LinesPanel, ItemBadge, PageState, Banner } = window.InnovicERPDesignSystem_4a2115;
  if (so.bom) return <PageState as="inline" state="noaccess" message="⚠ No BOM linked. Edit this SO to assign a BOM from BOM Master." />;
  if (!so.items.length) return <PageState as="inline" state="empty" message="No lines to preview in this mock." />;
  return <LinesPanel code={so.code} onOpenDetail={() => go('so-detail')}>
    <table className="innovic-table tbl-grid tbl-compact tbl-auto" style={{ margin: 0 }}>
      <thead><tr><th>Ln</th><th style={{ color: 'var(--purple)' }}>CPO Ln</th><th style={{ textAlign: 'left' }}>Item</th><th>Qty</th><th>JC Qty</th><th style={{ color: 'var(--green)' }}>Dispatched</th><th style={{ color: 'var(--red)' }}>Balance</th><th>Due Date</th><th>Status</th></tr></thead>
      <tbody>{so.items.map((l) => { const bal = Math.max(0, l.qty - l.disp); const [c, r] = l.code.split('/'); return <tr key={l.ln}>
        <td className="mono fw-700" style={{ color: 'var(--blue)' }}>{l.ln}</td>
        <td className="mono fw-700" style={{ fontSize: 'var(--fs-sm)', color: 'var(--purple)' }}>{l.cpo}</td>
        <td><ItemBadge showImage={false} code={c} revision={r} name={l.name} /></td>
        <td className="mono fw-700" style={{ fontSize: 'var(--fs-sm)' }}>{l.qty}</td>
        <td className="mono" style={{ fontSize: 'var(--fs-xs)' }}><span style={{ color: l.jc >= l.qty ? 'var(--green)' : l.jc > 0 ? 'var(--amber)' : 'var(--text3)' }}>{l.jc}</span><span className="text3" style={{ fontSize: 'var(--fs-xs)' }}> /{l.qty}</span></td>
        <td className="mono fw-700" style={{ color: l.disp > 0 ? 'var(--green)' : 'var(--text3)' }}>{l.disp}</td>
        <td className="mono fw-700" style={{ color: bal > 0 ? 'var(--red)' : 'var(--green)' }}>{bal <= 0 ? '✅ Done' : bal}</td>
        <td className="text2" style={{ fontSize: 'var(--fs-xs)' }}>{l.due}</td>
        <td><StatusBadge status={l.status} /></td></tr>; })}</tbody>
    </table>
  </LinesPanel>;
}

function SalesOrders({ go, toast }) {
  const { StatusBadge, Select, Button, Badge, ListHeader, StatusPills, ViewToggle, RowActions, DocCard, QtyStrip, ListFooter, PageState, ConfirmDialog } = window.InnovicERPDesignSystem_4a2115;
  const [status, setStatus] = useState(null);
  const [view, setView] = useState('list');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(new Set([1]));
  const [del, setDel] = useState(null);
  const today = '2026-09-23';
  const toggle = (id) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const rows = KIT_ORDERS.filter((o) => (!status || o.status === status) && (!q || (o.code + o.customer).toLowerCase().includes(q.toLowerCase())));
  const allOpen = rows.length > 0 && rows.every((r) => open.has(r.id));
  const late = (o) => o.due < today && o.status === 'open';
  const jcColor = (o) => o.jc >= o.qty && o.qty > 0 ? 'var(--green)' : o.jc > 0 ? 'var(--amber)' : 'var(--text3)';
  const accent = (o) => late(o) ? 'var(--red)' : (o.status === 'closed' || o.status === 'dispatched') ? 'var(--green)' : 'var(--blue)';
  const qtys = (so) => [{ label: 'Total Qty', value: so.qty }, { label: 'JC Qty', value: so.jc, color: jcColor(so) }, { label: 'Lines', value: so.lines }];

  return <div>
    <ListHeader title="SO / WO Orders" count={rows.length} noun="order" filterNote={status} search={q} onSearch={setQ}
      tools={<><Select options={['All types', 'Component', 'Equipment', 'With Material']} className="fw-md" />
        <Button variant="ghost" size="sm" icon={<Icon name="download" size={12} />} onClick={() => toast('info', 'Export started')}>Export</Button></>}
      primary={<Button onClick={() => go('so-new')}>+ New SO / WO</Button>}>
      <StatusPills options={['draft', 'open', 'dispatched', 'closed', 'cancelled']} value={status} onChange={setStatus}
        right={<ViewToggle value={view} onChange={setView} expandAll={allOpen} onExpandAll={() => setOpen(allOpen ? new Set() : new Set(rows.map((r) => r.id)))} />} />
    </ListHeader>

    {rows.length === 0 ? <PageState state="empty" message="No orders — click + New SO/WO" /> : view === 'list' ?
      <div className="tbl-wrap tbl-frozen"><table className="innovic-table tbl-grid tbl-auto">
        <thead><tr><th>Sr No</th><th>SO No.</th><th>Type</th><th style={{ textAlign: 'left' }}>Customer</th><th>Lines</th><th>Order Qty</th><th>JC Qty</th><th>Dispatched</th><th>Balance</th><th>Due Date</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{rows.map((so, i) => [
          <tr key={so.id} style={{ cursor: 'pointer' }} onClick={() => go('so-detail')}>
            <td className="text3">{i + 1}</td>
            <td><div style={{ whiteSpace: 'nowrap' }}><button type="button" onClick={(e) => { e.stopPropagation(); toggle(so.id); }} style={{ background: 'none', border: 0, padding: 0, marginRight: 2, cursor: 'pointer', color: 'var(--blue)', display: 'inline-flex', verticalAlign: 'middle' }}><Icon name={open.has(so.id) ? 'chevron-down' : 'chevron-right'} size={14} /></button><span className="td-code">{so.code}</span></div>
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>{so.date}</div></td>
            <td><Badge tone="grey">{so.type}</Badge>{so.bom ? <div style={{ marginTop: 4 }}><Badge tone="amber">{so.bom}</Badge></div> : null}</td>
            <td style={{ textAlign: 'left' }}><div className="fw-700" style={{ maxWidth: 'var(--field-lg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={so.customer}>{so.customer}</div>
              <div className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)', whiteSpace: 'nowrap' }}>CPO: <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{so.cpo}</span></div></td>
            <td className="mono">{so.lines}</td><td className="mono fw-700">{so.qty}</td>
            <td className="mono fw-700" style={{ color: jcColor(so) }}>{so.jc}</td>
            <td className="mono fw-700" style={{ color: 'var(--green)' }}>{so.disp}</td>
            <td className="mono fw-700" style={{ color: 'var(--red)' }}>{Math.max(0, so.qty - so.disp)}</td>
            <td className="mono" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', color: late(so) ? 'var(--red)' : 'var(--text2)', fontWeight: late(so) ? 700 : undefined }}>{so.due}{late(so) ? ' ⚠' : ''}</td>
            <td><StatusBadge status={so.status} /></td>
            <td><RowActions onView={() => go('so-detail')} onEdit={() => go('so-new')} onDelete={so.status !== 'closed' ? () => setDel(so) : undefined} /></td>
          </tr>,
          open.has(so.id) ? <tr key={so.id + '-l'}><td colSpan={12} style={{ background: 'var(--bg3)', padding: 0, textAlign: 'left' }}><LineItems so={so} go={go} /></td></tr> : null,
        ])}</tbody></table></div>
      : rows.map((so) => <DocCard key={so.id} accent={accent(so)} expanded={open.has(so.id)} onToggle={() => toggle(so.id)} onOpen={() => go('so-detail')}
          code={so.code} title={so.customer} badges={<><Badge tone="grey">{so.type}</Badge><StatusBadge status={so.status} />{so.bom ? <Badge tone="amber">{so.bom}</Badge> : null}</>}
          actions={<><Button size="sm" onClick={() => go('so-new')}>+ Line</Button>{so.status !== 'closed' ? <Button size="sm" variant="danger" onClick={() => setDel(so)}>Del</Button> : null}</>}
          metrics={<QtyStrip items={qtys(so)} />}
          meta={[<span className="text2">{so.date}</span>, <>PO <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{so.cpo}</span></>, <span className="text2">{so.by}</span>,
            <span style={{ color: late(so) ? 'var(--red)' : undefined, fontWeight: late(so) ? 700 : undefined }}>Due {so.due}{late(so) ? ' ⚠' : ''}</span>, so.remarks]}>
          <LineItems so={so} go={go} />
        </DocCard>)}

    <ListFooter total={rows.length} noun="sales order" limit={1000}
      hint={view === 'list' ? <>Click a row to open its detail page · click ▸ before the <b>SO number</b> to show its line items · use <b>+ Line</b> to add or edit lines.</> : <>Click the <b>SO number</b> to open its detail page · click the card to show its line items · use <b>+ Line</b> to add or edit lines.</>} />
    {del ? <ConfirmDialog title={`Delete SO ${del.code}?`} message="This soft-deletes the whole order. It can be restored from Trash." confirmLabel="Delete" onCancel={() => setDel(null)} onConfirm={() => { toast('err', `SO ${del.code} moved to Trash`); setDel(null); }} /> : null}
  </div>;
}
window.SalesOrders = SalesOrders;
