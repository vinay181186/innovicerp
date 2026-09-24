import React from 'react';
export function PrintDocument({ title = 'PURCHASE ORDER', company = {}, recipient = {}, meta = [], lines = [], priced = true, totals, notes, terms, pan = 'AQKPM4121A', testBanner = false, logoSrc }) {
  return <div className="print-doc" style={{ padding: 20 }}>
    {testBanner ? <div className="test-banner">ⓘ TEST PRINT — Sample data shown. Real data is substituted on actual prints.</div> : null}
    <div className="doc-border">
      <div className="doc-hdr" style={{ gap: 14 }}>{logoSrc ? <img src={logoSrc} alt="" style={{ height: 40 }} /> : null}
        <div><div style={{ fontWeight: 900, fontSize: 16 }}>{company.name}</div>{company.gstin ? <div style={{ fontSize: 10 }}>GSTIN: {company.gstin}</div> : null}</div></div>
      <div className="title-bar">{title}</div>
      <div className="addr-row">
        <div className="addr-box"><div className="addr-lbl">{recipient.label || 'Supplier (Bill from)'}</div><div className="addr-name">{recipient.name}</div>{(recipient.lines || []).map((l, i) => <div key={i}>{l}</div>)}</div>
        <div className="addr-box">{meta.map((m, i) => <div key={i} style={{ marginBottom: 4 }}><span className="meta-lbl">{m.label}:</span> <b>{m.value}</b></div>)}</div>
      </div>
      <div className="section"><table><thead><tr><th style={{ width: 44 }}>Sr No.</th><th style={{ width: 130 }}>Item Code</th><th>Item Name</th><th style={{ textAlign: 'right' }}>Qty</th><th>UOM</th>{priced ? <><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></> : null}</tr></thead>
        <tbody>{lines.map((l, i) => <tr key={i}><td style={{ textAlign: 'center' }}>{i + 1}</td><td>{l.itemCode}</td><td>{l.itemName || '—'}</td><td style={{ textAlign: 'right' }}>{l.qty}</td><td style={{ textAlign: 'center' }}>{l.uom || 'NOS'}</td>
          {priced ? <><td style={{ textAlign: 'right' }}>{l.rate}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{l.amount}</td></> : null}</tr>)}
          {priced && totals ? <><tr style={{ background: '#f8fafc' }}><td colSpan={6} style={{ textAlign: 'right', fontWeight: 600 }}>Subtotal</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{totals.subtotal}</td></tr>
            {(totals.taxRows || []).map((t, i) => <tr key={i}><td colSpan={6} style={{ textAlign: 'right' }}>{t.label}</td><td style={{ textAlign: 'right' }}>{t.value}</td></tr>)}
            <tr style={{ background: '#f1f5f9' }}><td colSpan={6} style={{ textAlign: 'right', fontWeight: 800 }}>TOTAL</td><td style={{ textAlign: 'right', fontWeight: 800 }}>₹ {totals.grand}</td></tr></> : null}
        </tbody></table></div>
      {priced && totals && totals.words ? <div className="amt-words"><b>Amount Chargeable (in words)</b><br /><i>{totals.words}</i></div> : null}
      {notes ? <div className="section" style={{ background: '#fffbeb' }}><b style={{ fontSize: 10, color: '#92400e', textTransform: 'uppercase' }}>Special Notes</b><br /><div className="note-block">{notes}</div></div> : null}
      {terms ? <div className="section"><b style={{ fontSize: 10, textTransform: 'uppercase' }}>Terms &amp; Conditions</b><br /><div className="note-block">{terms}</div></div> : null}
      <div className="sign-row"><div style={{ padding: 14, fontSize: 10, flex: 1 }}>Company's PAN: <b>{pan}</b><br /><span style={{ fontStyle: 'italic', color: '#666' }}>E. &amp; O.E.</span></div>
        <div style={{ flex: 1, padding: 14, textAlign: 'right', fontSize: 11 }}>For {company.name}<br /><br /><br />Authorised Signatory</div></div>
      {company.address ? <div style={{ textAlign: 'center', fontSize: 9, color: '#555', padding: '6px 14px', borderTop: '1px solid #999' }}>{company.address}</div> : null}
    </div>
  </div>;
}
