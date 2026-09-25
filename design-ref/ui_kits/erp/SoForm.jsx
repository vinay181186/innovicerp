// New SO / WO — document header (12-col FormGrid, sized by content) + line items. Abbreviated from sales-order-form.tsx.
function SoForm({ go, toast }) {
  const { Panel, FormGrid, FormField, Input, Select, Textarea, Button, DocNumberInput, SearchableSelect, RowActions, ConfirmDialog } = window.InnovicERPDesignSystem_4a2115;
  const [exit, setExit] = useState(false);
  const [client, setClient] = useState('c1');
  const [lines, setLines] = useState([{ code: 'BF-SH-2210', rev: 'B', name: 'Pinion Shaft', uom: 'NOS', qty: 60, rate: 1850, due: '2026-09-26' }]);
  const upd = (i, k, v) => setLines(lines.map((l, j) => j === i ? { ...l, [k]: v } : l));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  return <div style={{ paddingTop: 4 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <div className="section-hdr" style={{ marginBottom: 0 }}>New SO / WO</div>
      <div style={{ display: 'flex', gap: 8 }}><Button variant="ghost" onClick={() => setExit(true)}>Cancel</Button>
        <Button onClick={() => { toast('ok', '✓ SO IN-SO-26-0143 saved'); go('so'); }}>Save SO</Button></div>
    </div>
    <Panel title="Order header">
      <FormGrid>
        <DocNumberInput size="sm" label="SO No." required value="IN-SO-26-0143" state="ok" />
        <FormField label="SO Date" size="sm" required><Input type="date" defaultValue="2026-09-23" /></FormField>
        <FormField label="Type" size="sm" required><Select options={['Component', 'Equipment', 'With Material']} /></FormField>
        <FormField label="GST" size="sm"><Select options={['18% IGST', '9% CGST + 9% SGST']} /></FormField>
        <FormField label="Client" size="lg" required><SearchableSelect value={client} onChange={setClient} options={[{ id: 'c1', code: 'CL-0021', name: 'Bharat Forge Ltd' }, { id: 'c2', code: 'CL-0034', name: 'Kirloskar Pneumatic Co.' }, { id: 'c3', code: 'CL-0040', name: 'Thermax Ltd' }]} /></FormField>
        <FormField label="Client PO No." size="sm"><Input placeholder="e.g. 4500087121" /></FormField>
        <FormField label="Client PO Date" size="sm"><Input type="date" /></FormField>
        <FormField label="Remarks" size="full"><Textarea rows={2} placeholder="Remarks" /></FormField>
      </FormGrid>
    </Panel>
    <Panel title="Line items" bodyPadding={0} actions={<Button size="sm" variant="ghost" onClick={() => setLines([...lines, { code: '', rev: '0', name: '', uom: 'NOS', qty: '', rate: '', due: '' }])}>+ Add line</Button>}>
      <table className="innovic-table tbl-grid tbl-edit tbl-auto">
        <thead><tr><th>Ln</th><th>Item Code</th><th>Rev</th><th>Part Name</th><th>UOM</th><th>Qty</th><th>Rate (₹)</th><th>Due Date</th><th>Amount</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}>
          <td className="mono fw-700" style={{ color: 'var(--blue)' }}>{i + 1}</td>
          <td><Input value={l.code} onChange={(e) => upd(i, 'code', e.target.value)} className="fw-md" /></td>
          <td><Input value={l.rev} onChange={(e) => upd(i, 'rev', e.target.value)} className="fw-xs" /></td>
          <td><Input value={l.name} onChange={(e) => upd(i, 'name', e.target.value)} className="fw-lg" /></td>
          <td><span className="tag" style={{ background: 'var(--bg4)', color: 'var(--text2)' }}>{l.uom}</span></td>
          <td><Input type="number" value={l.qty} onChange={(e) => upd(i, 'qty', e.target.value)} className="fw-sm" /></td>
          <td><Input type="number" value={l.rate} onChange={(e) => upd(i, 'rate', e.target.value)} className="fw-sm" /></td>
          <td><Input type="date" value={l.due} onChange={(e) => upd(i, 'due', e.target.value)} className="fw-md" /></td>
          <td className="mono fw-700">{((Number(l.qty) || 0) * (Number(l.rate) || 0)).toLocaleString('en-IN')}</td>
          <td><RowActions labelled onDelete={() => setLines(lines.filter((_, j) => j !== i))} /></td>
        </tr>)}</tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px', fontSize: 'var(--fs-sm)', color: 'var(--text2)', gap: 8 }}>Total <b className="mono" style={{ color: 'var(--text)' }}>₹ {total.toLocaleString('en-IN')}</b></div>
    </Panel>
    {exit ? <ConfirmDialog onCancel={() => setExit(false)} onConfirm={() => { setExit(false); go('so'); }} /> : null}
  </div>;
}

function Login({ onSignIn }) {
  const { Input } = window.InnovicERPDesignSystem_4a2115;
  const [mode, setMode] = useState('password');
  return <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 64 }}>
    <div className="panel" style={{ width: 448, padding: 32 }}>
      <img src={(window.__resources && window.__resources.logo) || '../../assets/innovic-logo.jpeg'} alt="Innovic" style={{ height: 28, marginBottom: 16 }} />
      <h1 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, margin: '0 0 4px', fontFamily: 'var(--hfont)' }}>{mode === 'reset' ? 'Reset your password' : 'Sign in to Innovic ERP'}</h1>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text3)', margin: '0 0 24px' }}>{mode === 'reset' ? "Enter your email and we'll send you a link to reset your password." : 'Enter your email and password.'}</p>
      <form onSubmit={(e) => { e.preventDefault(); onSignIn(); }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><label className="form-label">Email</label><Input type="email" placeholder="you@company.com" defaultValue="vinay@innovic.in" /></div>
        {mode === 'password' ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label className="form-label">Password</label>
            <button type="button" onClick={() => setMode('reset')} style={{ background: 'none', border: 0, color: 'var(--blue)', fontSize: 'var(--fs-sm)', textDecoration: 'underline', textUnderlineOffset: 4, cursor: 'pointer' }}>Forgot password?</button></div>
          <Input type="password" defaultValue="••••••••" /></div> : null}
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '8px 12px' }}>{mode === 'reset' ? 'Send reset link' : 'Sign in'}</button>
      </form>
      {mode === 'reset' ? <div style={{ textAlign: 'center', marginTop: 16 }}><button type="button" onClick={() => setMode('password')} style={{ background: 'none', border: 0, color: 'var(--text3)', fontSize: 'var(--fs-sm)', cursor: 'pointer' }}>Back to sign in</button></div> : null}
    </div>
  </main>;
}
Object.assign(window, { SoForm, Login });
