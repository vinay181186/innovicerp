// Extra screens: Live Operations, Task Board, SO detail (related docs + timeline), Create PO (compact), PO print.
function LiveOps({ toast }) {
  const { MachineCard, StatStrip, ConfirmDialog, ListHeader, ListFooter, PageState, Panel, StatusBadge } = window.InnovicERPDesignSystem_4a2115;
  const [sel, setSel] = useState('CNC-01');
  const [stop, setStop] = useState(null);
  const M = [
    { code: 'CNC-01', name: 'LMW LL20T', run: { jc: 'IN-JC-26-0917', item: 'BF-SH-2210/B', name: 'Pinion Shaft', op: 10, opn: 'CNC Turning', who: 'Sunil P.', at: '2026-09-23 07:42' } },
    { code: 'VMC-02', name: 'BFW Gaurav', run: { jc: 'IN-JC-26-0922', item: 'BF-GR-1180/A', name: 'Spur Gear 42T', op: 20, opn: 'Drilling', who: 'Amit S.', at: '2026-09-23 08:05' } },
    { code: 'CG-02', name: 'Cylindrical Grinder' }, { code: 'HOB-01', name: 'Hobbing M/c' },
    { code: 'CNC-03', name: 'Ace Jobber XL', run: { jc: 'IN-JC-26-0910', item: 'KP-VH-0091/C', name: 'Valve Housing', op: 30, opn: 'Facing', who: 'Ravi T.', at: '2026-09-23 06:58' } },
    { code: 'SAW-01', name: 'Bandsaw' },
  ];
  const running = M.filter((m) => m.run);
  return <div>
    <ListHeader icon="🔴" title="Live Operations" count={running.length} noun="running session"><StatStrip items={[{ key: 'r', label: 'Running', count: running.length, color: 'var(--green)' }, { key: 'i', label: 'Idle', count: M.length - running.length, color: 'var(--text3)' }, { key: 'o', label: "Today's Output", count: '386 pcs', color: 'var(--sig-ok)' }]} /></ListHeader>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
      {M.map((m) => <MachineCard key={m.code} code={m.code} name={m.name} running={!!m.run} jobCard={m.run && m.run.jc} itemCode={m.run && m.run.item} operation={m.run && `Op${m.run.op}: ${m.run.opn}`} selected={sel === m.code} onSelect={() => setSel(m.code)} />)}
    </div>
    <Panel title="Running now" actions={<span className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>{running.length} sessions</span>} bodyPadding={0}>
      <div className="tbl-wrap"><table className="innovic-table tbl-grid tbl-auto">
        <thead><tr><th>JC</th><th>Item Code</th><th>Item Name</th><th>Op</th><th>Operation</th><th>Machine (Planned / Actual)</th><th>Operator</th><th>Started</th><th>Status</th><th /></tr></thead>
        <tbody>{running.length === 0 ? <PageState as="row" colSpan={10} message="No ops currently running." /> : running.map((m) => <tr key={m.code} style={sel === m.code ? { outline: '2px solid var(--cyan)', outlineOffset: -2 } : undefined}>
          <td className="td-code cyan">{m.run.jc}</td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{m.run.item}</td>
          <td style={{ fontSize: 'var(--fs-sm)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.run.name}</td>
          <td className="mono">{m.run.op}</td><td>{m.run.opn}</td><td className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>{m.code} / {m.code}</td>
          <td style={{ fontSize: 'var(--fs-sm)' }}>{m.run.who}</td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{m.run.at}</td>
          <td><StatusBadge kind="run" status="running" /></td>
          <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setStop(m)}><Icon name="square" size={13} /> Stop</button></td>
        </tr>)}</tbody>
      </table></div>
    </Panel>
    <ListFooter total={running.length} noun="running session" hint="Click a machine to highlight its session · Stop commits the produced qty to the op log." />
    {stop ? <ConfirmDialog title={`Stop ${stop.run.jc} · Op ${stop.run.op}?`} message={`${stop.run.item} — ${stop.run.name} on ${stop.code}. Produced qty will be committed to the op log.`} confirmLabel="Stop" onCancel={() => setStop(null)} onConfirm={() => { toast('ok', `✓ ${stop.run.jc} Op ${stop.run.op} stopped`); setStop(null); }} /> : null}
  </div>;
}

function TaskBoard({ toast }) {
  const { TabStrip, FilterBar, ListHeader, ListFooter, RowActions, PageState, Button, Tag, PriorityText, StatusBadge } = window.InnovicERPDesignSystem_4a2115;
  const [view, setView] = useState('inbox');
  const [q, setQ] = useState('');
  const T = [
    { code: 'T-0412', title: 'Create BOM for IN-SO-26-0136', by: 'Vinay K.', ref: 'SO IN-SO-26-0136', pri: 'Urgent', due: '2026-09-20', over: true, st: ['b-amber', 'To Do'], upd: '2026-09-22 16:04', unread: true, att: 2, cm: 1 },
    { code: 'T-0409', title: 'Follow up KPC dispatch', by: 'Rahul M.', ref: 'SO IN-SO-26-0139', pri: 'High', due: '2026-09-25', st: ['b-blue', 'In Progress'], upd: '2026-09-23 09:10' },
    { code: 'T-0401', title: 'Dispose NC-0214 (4 pcs OD undersize)', by: 'Sneha P.', ref: 'NC NC-0214', pri: 'Normal', due: '2026-09-26', st: ['b-amber', 'To Do'], upd: '2026-09-21 11:32' },
    { code: 'T-0388', title: 'Approve PR-26-0311', by: 'Store', ref: 'PR PR-26-0311', pri: 'Low', due: '2026-09-18', st: ['b-green', 'Completed'], upd: '2026-09-18 17:55' },
  ].filter((t) => !q || (t.code + t.title).toLowerCase().includes(q.toLowerCase()));
  const pc = (p) => p === 'Urgent' ? 'var(--red)' : p === 'High' ? 'var(--amber2)' : 'var(--text2)';
  return <div>
    <ListHeader icon="📋" title="Task Board" count={T.length} noun="task" sticky={false} primary={<Button onClick={() => toast('info', 'Assign Task opened')}>+ Assign Task</Button>} />
    <TabStrip activeKey={view} onChange={setView} tabs={[{ key: 'inbox', label: 'Inbox', count: 3 }, { key: 'outbox', label: 'Outbox', count: 2 }, { key: 'todo', label: 'My To-Do', count: 1 }, { key: 'all', label: 'All Tasks', note: '(Admin)' }]} />
    <FilterBar search={q} onSearch={setQ} placeholder="Search Task#, title, related document…" filters={[{ key: 's', options: ['All Status', 'To Do', 'In Progress', 'Completed', 'Cancelled'] }, { key: 'p', options: ['All Priority', 'Urgent', 'High', 'Normal', 'Low'] }, { key: 'a', options: ['Assigned By: All', 'Vinay K.', 'Rahul M.'] }, { key: 'd', options: ['Due Date: All', 'Today', 'This Week', 'Overdue'] }]} />
    <div className="panel" style={{ marginBottom: 0 }}>
      <div className="tbl-wrap tbl-frozen"><table className="innovic-table tbl-grid tbl-auto">
        <thead><tr><th>Task#</th><th>Title</th><th>Assigned By</th><th>Related To</th><th>Priority</th><th>Due Date</th><th>Status</th><th>Last Update</th><th>Actions</th></tr></thead>
        <tbody>{T.length === 0 ? <PageState as="row" colSpan={9} message="No tasks found" /> : T.map((t) => <tr key={t.code} style={{ cursor: 'pointer' }}>
          <td className="td-code mono fw-700" style={{ color: 'var(--blue)' }}>{t.unread ? <span className="task-unread" /> : null}{t.code}</td>
          <td><span style={{ fontWeight: 700 }}>{t.title}</span>{t.att ? <span className="text3" style={{ fontSize: 'var(--fs-xs)', marginLeft: 4 }}>📎{t.att}</span> : null}{t.cm ? <span className="text3" style={{ fontSize: 'var(--fs-xs)', marginLeft: 4 }}>💬{t.cm}</span> : null}</td>
          <td style={{ fontSize: 'var(--fs-sm)' }}>{t.by}</td><td><Tag>{t.ref}</Tag></td>
          <td><PriorityText priority={t.pri} /></td>
          <td className="mono" style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: t.over ? 'var(--red)' : 'var(--text)' }}>{t.due}{t.over ? ' ⚠' : ''}</td>
          <td><StatusBadge kind="task" status={t.st[1]} /></td><td className="mono text3" style={{ fontSize: 'var(--fs-xs)' }}>{t.upd}</td>
          <td><RowActions onView={() => {}} onEdit={t.st[1] !== 'Completed' ? () => {} : undefined}
            extra={t.st[1] !== 'Completed' ? <><button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ padding: '4px 4px' }} title="Mark completed" onClick={(e) => { e.stopPropagation(); toast('ok', `✓ ${t.code} completed`); }}><Icon name="check" size={13} /></button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" style={{ padding: '4px 4px' }} title="Reassign"><Icon name="user-round" size={13} /></button></> : null} /></td>
        </tr>)}</tbody>
      </table></div>
    </div>
    <ListFooter total={T.length} noun="task" hint="Inbox: tasks assigned to the logged-in user by other users. Click a row to open it." />
  </div>;
}

function SoDetail({ go }) {
  const { StatusBadge, QtyStrip, RelatedDocs, Timeline, ItemBadge, Panel, DetailHeader, ReadGrid, ReadField, Badge, Button } = window.InnovicERPDesignSystem_4a2115;
  const so = KIT_ORDERS[0];
  const [tab, setTab] = useState('jc');
  const sections = [
    { key: 'client', title: 'Client', icon: '🏢', items: [{ code: 'CL-0021', label: so.customer, status: <StatusBadge kind="doc" status="approved" />, date: '—' }] },
    { key: 'jc', title: 'Job Cards', icon: '▭', items: [{ code: 'IN-JC-26-0917', label: 'Pinion Shaft', status: <StatusBadge kind="jc" status="open" />, date: '2026-09-19' }, { code: 'IN-JC-26-0918', label: 'Spur Gear 42T', status: <StatusBadge kind="jc" status="qc_pending" />, date: '2026-09-19' }] },
    { key: 'po', title: 'Purchase Orders', icon: '📋', items: [{ code: 'IN-MPO-26-0311', label: 'EN19 Ø45 bar', status: <StatusBadge kind="po" status="open" />, date: '2026-09-20' }] },
    { key: 'disp', title: 'Dispatches', icon: '🚚', items: [{ code: 'IN-CD-26-0088', label: '40 pcs', status: <StatusBadge kind="doc" status="dispatched" />, date: '2026-09-22' }] },
  ];
  return <div style={{ paddingTop: 4 }}>
    <DetailHeader backLabel="Back to SO Master" onBack={() => go('so')} code={so.code} name={so.customer}
      badges={<><Badge tone="grey">{so.type}</Badge><StatusBadge status={so.status} /></>}
      actions={<><Button variant="ghost" size="sm" icon={<Icon name="pencil" size={13} />} onClick={() => go('so-new')}>Edit</Button><Button variant="ghost" size="sm" icon={<Icon name="printer" size={13} />}>Print</Button><Button variant="danger" size="sm" icon={<Icon name="trash-2" size={13} />}>Delete</Button></>}>
      <ReadGrid>
        <ReadField label="Client PO" size="sm" mono value={<span style={{ color: 'var(--purple)', display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>{so.cpo} <Icon name="paperclip" size={13} /></span>} /><ReadField label="SO Date" size="sm" mono value={so.date} /><ReadField label="Due Date" size="sm" mono value={so.due} /><ReadField label="Raised By" size="sm" value={so.by} />
        <ReadField label="Quantities" size="full" value={<QtyStrip items={[{ label: 'Total Qty', value: so.qty }, { label: 'JC Qty', value: so.jc, color: 'var(--green)' }, { label: 'Dispatched', value: so.disp, color: 'var(--green)' }, { label: 'Lines', value: so.lines }]} />} />
        <ReadField label="Remarks" size="full" value={so.remarks} />
      </ReadGrid>
    </DetailHeader>
    <Panel title="Line items" bodyPadding={0}>
      <table className="innovic-table tbl-grid">
        <colgroup><col style={{ width: '5%' }} /><col style={{ width: '7%' }} /><col style={{ width: '8%' }} /><col style={{ width: '30%' }} /><col style={{ width: '8%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /></colgroup>
        <thead><tr><th>Ln</th><th style={{ color: 'var(--purple)' }}>CPO Ln</th><th style={{ padding: '4px 2px', fontSize: 'var(--fs-xs)' }}>Thumbnail</th><th style={{ textAlign: 'left' }}>Item</th><th>Qty</th><th>JC Qty</th><th style={{ color: 'var(--green)' }}>Dispatched</th><th style={{ color: 'var(--red)' }}>Balance</th><th>Status</th></tr></thead>
        <tbody>{so.items.map((l) => { const [c, r] = l.code.split('/'); const bal = l.qty - l.disp; return <tr key={l.ln}>
          <td className="mono fw-700" style={{ color: 'var(--blue)' }}>{l.ln}</td><td className="mono fw-700" style={{ fontSize: 'var(--fs-sm)', color: 'var(--purple)' }}>{l.cpo}</td>
          <td style={{ padding: 0, position: 'relative', height: 40 }}><div style={{ position: 'absolute', inset: 0, background: 'var(--bg4)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}><Icon name="package" size={16} /></div></td>
          <td><ItemBadge showImage={false} code={c} revision={r} name={l.name} /></td>
          <td className="mono fw-700" style={{ fontSize: 'var(--fs-sm)' }}>{l.qty}</td><td className="mono" style={{ fontSize: 'var(--fs-xs)' }}><span style={{ color: 'var(--green)' }}>{l.jc}</span><span className="text3" style={{ fontSize: 'var(--fs-xs)' }}> /{l.qty}</span></td>
          <td className="mono fw-700" style={{ color: l.disp ? 'var(--green)' : 'var(--text3)' }}>{l.disp}</td><td className="mono fw-700" style={{ color: bal > 0 ? 'var(--red)' : 'var(--green)' }}>{bal > 0 ? bal : '✅ Done'}</td>
          <td><StatusBadge status={l.status} /></td></tr>; })}</tbody>
      </table>
    </Panel>
    <RelatedDocs sections={sections} activeKey={tab} onSelect={setTab}>
      <Timeline density="compact" title="🕒 Document Timeline" events={[{ date: '2026-09-18 10:12', label: 'SO created', code: so.code }, { date: '2026-09-19 09:30', label: 'Job cards raised', code: 'IN-JC-26-0917' }, { date: '2026-09-20 15:02', label: 'PO raised', code: 'IN-MPO-26-0311' }, { date: '2026-09-22 17:40', label: 'Dispatched', code: 'IN-CD-26-0088' }]} />
    </RelatedDocs>
  </div>;
}

function PoCompact({ go, toast }) {
  const { PrintDocument, Panel, FormGrid, FormField, Input, Select, DocNumberInput, SearchableSelect, DataTable, RowActions, Button, Tag, ConfirmDialog, Banner } = window.InnovicERPDesignSystem_4a2115;
  const [lines, setLines] = useState([{ pr: 'PR-26-0311', code: 'RM-EN19-45', name: 'EN19 Round Bar Ø45 × 3m', qty: 12, uom: 'NOS', rate: 1850 }, { pr: 'PR-26-0314', code: 'HT-SVC-01', name: 'Hardening & Tempering 28–32 HRC', qty: 60, uom: 'NOS', rate: 45 }]);
  const [vendor, setVendor] = useState('1');
  const [print, setPrint] = useState(false);
  const [exit, setExit] = useState(false);
  const sub = lines.reduce((a, l) => a + l.qty * l.rate, 0); const gst = sub * 0.09; const grand = sub + 2 * gst;
  const f = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const upd = (i, k, v) => setLines(lines.map((x, j) => j === i ? { ...x, [k]: Number(v) || 0 } : x));
  if (print) return <div style={{ paddingTop: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}><Button icon={<Icon name="printer" size={14} />} onClick={() => window.print()}>Print</Button><Button variant="ghost" icon={<Icon name="x" size={14} />} onClick={() => setPrint(false)}>Close</Button></div>
    <div style={{ maxWidth: 820, margin: '0 auto', background: '#fff' }}><PrintDocument logoSrc={(window.__resources && window.__resources.logo) || '../../assets/innovic-logo.jpeg'} title="PURCHASE ORDER" company={{ name: 'Innovic Engineering Pvt. Ltd.', gstin: '27AAACI0000A1Z5', address: 'Plot 14, MIDC Bhosari, Pune 411026' }}
      recipient={{ name: 'Precision Heat Treat', lines: ['Gat 221, Chakan Industrial Area, Pune', 'GSTIN: 27AAPFP0000B1Z2'] }} meta={[{ label: 'PO No.', value: 'IN-MPO-26-0312' }, { label: 'PO Date', value: '23-09-2026' }, { label: 'Delivery', value: '7 days' }]}
      lines={lines.map((l) => ({ itemCode: l.code, itemName: l.name, qty: String(l.qty), uom: l.uom, rate: f(l.rate), amount: f(l.qty * l.rate) }))}
      totals={{ subtotal: f(sub), taxRows: [{ label: 'CGST @ 9%', value: f(gst) }, { label: 'SGST @ 9%', value: f(gst) }], grand: f(grand), words: 'Indian Rupees Twenty Nine Thousand Three Hundred Eighty Two Only' }} /></div>
  </div>;
  return <div style={{ paddingTop: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <div><div className="section-hdr" style={{ marginBottom: 0 }}>📋 Create Purchase Order</div><div className="text3" style={{ fontSize: 'var(--fs-sm)', marginTop: 2 }}>From open purchase requests · fields marked ★ are required</div></div>
      <div style={{ display: 'flex', gap: 8 }}><Button variant="ghost" onClick={() => setExit(true)}>Cancel</Button><Button variant="ghost" icon={<Icon name="printer" size={14} />} onClick={() => setPrint(true)}>Preview print</Button><Button variant="success" icon={<Icon name="check" size={14} />} onClick={() => toast('ok', '✓ IN-MPO-26-0312 created')}>Create PO</Button></div>
    </div>
    <Panel title="Order header">
      <FormGrid>
        <DocNumberInput size="sm" label="PO No." required value="IN-MPO-26-0312" state="ok" />
        <FormField label="PO Date" size="sm" required><Input type="date" defaultValue="2026-09-23" /></FormField>
        <FormField label="PO Type" size="md"><Select options={['Material PO', 'Job Work PO', 'Service PO']} /></FormField>
        <FormField label="Delivery Days" size="xs"><Input type="number" className="mono" defaultValue="7" /></FormField>
        <FormField label="Vendor" size="lg" required><SearchableSelect value={vendor} onChange={setVendor} options={[{ id: '1', code: 'VND-012', name: 'Precision Heat Treat' }, { id: '2', code: 'VND-031', name: 'Shree Ganesh Plating' }]} /></FormField>
      </FormGrid>
    </Panel>
    {!vendor ? <Banner tone="warn">Select a Vendor first to pick open PRs.</Banner> : null}
    <Panel title="Line items" bodyPadding={0} actions={<Button size="sm" variant="ghost" icon={<Icon name="plus" size={13} />}>Add PR line</Button>}>
      <DataTable editable columns={[
        { header: 'Sr No', width: '5%', render: (r, i) => i + 1, className: 'mono fw-700' },
        { header: 'PR No.', width: '12%', render: (r) => <Tag>{r.pr}</Tag> },
        { header: 'Item Code', width: '13%', render: (r) => <Input className="mono" defaultValue={r.code} /> },
        { header: 'Item Name', align: 'left', render: (r) => <Input defaultValue={r.name} /> },
        { header: 'Qty', width: '8%', render: (r, i) => <Input type="number" className="mono" value={r.qty} onChange={(e) => upd(i, 'qty', e.target.value)} /> },
        { header: 'UOM', width: '7%', render: (r) => <Tag tone="neutral">{r.uom}</Tag> },
        { header: 'Rate (₹)', width: '10%', render: (r, i) => <Input type="number" className="mono" value={r.rate} onChange={(e) => upd(i, 'rate', e.target.value)} /> },
        { header: 'Amount (₹)', width: '12%', align: 'right', className: 'mono fw-700', render: (r) => f(r.qty * r.rate) },
        { header: 'Action', width: '7%', render: (r, i) => <RowActions labelled onDelete={() => setLines(lines.filter((_, j) => j !== i))} /> },
      ]} rows={lines} emptyText="No lines — pick a PR to add its items." />
    </Panel>
    <Panel title="Tax & totals">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <FormField label="Tax Type"><Select className="fw-md" options={['CGST + SGST', 'IGST']} /></FormField>
        <FormField label="CGST %"><Input className="mono fw-xs" defaultValue="9" /></FormField>
        <FormField label="SGST %"><Input className="mono fw-xs" defaultValue="9" /></FormField>
        <div style={{ marginLeft: 'auto', display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 16px', textAlign: 'right', alignItems: 'baseline' }}>
          {[['Subtotal', f(sub)], ['CGST', f(gst)], ['SGST', f(gst)]].map(([l, v]) => <React.Fragment key={l}><span className="form-label" style={{ textAlign: 'left' }}>{l}</span><span className="mono fw-700">{v}</span></React.Fragment>)}
          <span className="form-label" style={{ textAlign: 'left', color: 'var(--text)' }}>Grand Total</span><span className="mono fw-700" style={{ fontSize: 'var(--fs-md)', color: 'var(--text)' }}>₹ {f(grand)}</span>
        </div>
      </div>
    </Panel>
    {exit ? <ConfirmDialog onCancel={() => setExit(false)} onConfirm={() => { setExit(false); go('home'); }} /> : null}
  </div>;
}
Object.assign(window, { LiveOps, TaskBoard, SoDetail, PoCompact });
