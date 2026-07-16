// Print Templates — admin-only WYSIWYG editor. Mirror of legacy
// renderPrintTemplates (L14660) + _pteRenderBlock (L14819). Legacy's 3 docs
// (PO / OSP DC / JW DC) plus our SERVICE PO, 5 editable blocks each, variable
// insertion, last-5 revision rollback, test print.
// See docs/PARITY/print-templates.md.

import {
  type EffectivePrintTemplate,
  PRINT_DOC_TYPES,
  PRINT_TEMPLATE_VARS,
  type PrintDocType,
  substituteTemplateVars,
  unknownTemplateVars,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { format } from 'date-fns';
import { Loader2, Pencil, Printer } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePrintTemplates, useRestorePrintTemplateDefault, useSavePrintTemplate } from '../api';
import { RevisionsModal } from '../components/revisions-modal';
import { openTestPrint, sampleDataFor } from '../lib/test-print';

export const printTemplatesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'print-templates',
  component: PrintTemplatesPage,
});

const DOC_COLOR: Record<PrintDocType, string> = {
  PO: '#1E4DB3',
  'SERVICE PO': '#0e7490',
  'OSP DC': '#7c3aed',
  'JW DC': '#c47a00',
};
const DOC_LABEL: Record<PrintDocType, string> = {
  PO: 'Purchase Order',
  'SERVICE PO': 'Service Purchase Order',
  'OSP DC': 'OSP Delivery Challan',
  'JW DC': 'Job Work DC',
};
// Title printed on the document itself (legacy titleText L14708). Distinct from
// the selector button label — legacy's "Job Work DC" button prints as
// "JOB WORK DELIVERY CHALLAN". Mirrors DOC_TITLE in @/lib/print/doc-print.
const DOC_TITLE: Record<PrintDocType, string> = {
  PO: 'PURCHASE ORDER',
  'SERVICE PO': 'SERVICE PURCHASE ORDER',
  'OSP DC': 'OSP DELIVERY CHALLAN',
  'JW DC': 'JOB WORK DELIVERY CHALLAN',
};

function lastEditLabel(t: EffectivePrintTemplate): string {
  if (!t.isCustomised) return 'Factory default';
  const who = t.lastEditedBy ?? '?';
  if (!t.lastEditedAt) return `Edited by ${who}`;
  const d = new Date(t.lastEditedAt);
  return Number.isNaN(d.getTime())
    ? `Edited by ${who}`
    : `Edited by ${who} on ${format(d, 'dd-MM-yyyy')}`;
}

function PrintTemplatesPage(): React.JSX.Element {
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';

  const [doc, setDoc] = useState<PrintDocType>('PO');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [revisionsKey, setRevisionsKey] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading, isError } = usePrintTemplates({ enabled: isAdmin });
  const save = useSavePrintTemplate();
  const restore = useRestorePrintTemplateDefault();

  const allTemplates = useMemo(() => data?.items ?? [], [data]);
  const docTemplates = useMemo(() => allTemplates.filter((t) => t.doc === doc), [allTemplates, doc]);
  const sample = useMemo(() => sampleDataFor(doc), [doc]);
  const allowedVars = PRINT_TEMPLATE_VARS[doc];
  // PO and Service PO both print the priced goods table + amount in words; the
  // two DC docs print a qty-only table. Mirrors `isPo` in @/lib/print/doc-print,
  // so the mock previews what actually prints.
  const isPo = doc === 'PO' || doc === 'SERVICE PO';
  const blockOf = (b: string): EffectivePrintTemplate | undefined =>
    docTemplates.find((t) => t.block === b);

  const unknownVars = editingKey ? unknownTemplateVars(draft, allowedVars) : [];

  function startEdit(t: EffectivePrintTemplate): void {
    setEditingKey(t.templateKey);
    setDraft(t.content);
  }
  function cancelEdit(): void {
    setEditingKey(null);
    setDraft('');
  }
  function commitSave(): void {
    if (!editingKey) return;
    if (unknownVars.length > 0) {
      const ok = window.confirm(
        `Unknown variable(s): ${unknownVars.map((v) => `{${v}}`).join(', ')}\n\nThese will print as blank. Save anyway?`,
      );
      if (!ok) return;
    }
    save.mutate(
      { key: editingKey, content: draft },
      { onSuccess: () => cancelEdit() },
    );
  }
  function resetBlock(key: string): void {
    if (editingKey) return;
    if (!window.confirm('Reset this block to the factory default?')) return;
    restore.mutate(key);
  }
  function insertVar(v: string): void {
    const ta = taRef.current;
    const token = `{${v}}`;
    if (!ta) {
      setDraft((d) => d + token);
      return;
    }
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const next = draft.slice(0, s) + token + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + token.length;
    });
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--sig-critical)' }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
        <div className="fw-700">Admin access required</div>
        <div className="text3" style={{ fontSize: 12, marginTop: 6 }}>
          Print Templates can be edited only by Admin users.
        </div>
      </div>
    );
  }

  // Mirror of legacy _pteRenderBlock (L14819). `isSmallCentered` is the Footer
  // block, `isSignature` the Signature Block — legacy styles both differently.
  function renderBlock(
    t: EffectivePrintTemplate | undefined,
    opts?: { isSmallCentered?: boolean; isSignature?: boolean },
  ): React.JSX.Element | null {
    if (!t) return null;
    const isSmallCentered = opts?.isSmallCentered ?? false;
    const isSignature = opts?.isSignature ?? false;
    const isEditing = editingKey === t.templateKey;
    // Legacy keys the block accent off whether the block HAS content (L14827-28),
    // not off whether it was customised.
    const content = t.content;
    const rendered = content ? substituteTemplateVars(content, sample) : '';
    const accent = isEditing ? '#d97706' : content ? '#16a34a' : '#94a3b8';
    return (
      <div
        key={t.templateKey}
        data-key={t.templateKey}
        style={{
          position: 'relative',
          border: `2px ${isEditing ? 'solid' : 'dashed'} ${isEditing ? '#d97706' : content ? '#16a34a' : '#cbd5e1'}`,
          background: isEditing ? '#fffbeb' : isSignature ? '#ffffff' : content ? '#f0fdf4' : '#fafafa',
          margin: isSmallCentered ? 0 : '4px 8px',
          padding: isSmallCentered ? '8px 14px' : '12px 14px',
          borderRadius: 4,
          textAlign: isSmallCentered ? 'center' : isSignature ? 'right' : undefined,
          minHeight: isSignature ? 90 : content ? 'auto' : 40,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -9,
            left: 8,
            background: accent,
            color: '#fff',
            padding: '1px 8px',
            borderRadius: 3,
            fontSize: 9,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '.04em',
          }}
        >
          {isEditing ? '✎ Editing: ' : ''}
          {t.name}
        </div>

        {isEditing ? (
          <>
            <textarea
              ref={taRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                width: '100%',
                minHeight: 140,
                marginTop: 4,
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontFamily: 'var(--mono)',
                fontSize: 13,
                background: '#fff',
                color: '#1e293b',
                resize: 'vertical',
                textAlign: 'left',
              }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              <div className="text2" style={{ fontSize: 10 }}>
                <b>Tip:</b> Click variables on the right panel to insert at cursor.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={commitSave}
                  disabled={save.isPending}
                >
                  {save.isPending ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '💾'} Save
                </button>
              </div>
            </div>
            {unknownVars.length > 0 ? (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--sig-warn)', textAlign: 'left' }}>
                ⚠ Unknown variable{unknownVars.length > 1 ? 's' : ''}:{' '}
                {unknownVars.map((v) => (
                  <span
                    key={v}
                    className="mono"
                    style={{
                      background: 'var(--sig-warn-bg)',
                      padding: '1px 5px',
                      borderRadius: 3,
                      marginRight: 4,
                    }}
                  >
                    {`{${v}}`}
                  </span>
                ))}{' '}
                — will print as blank
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div
              onClick={() => startEdit(t)}
              title="Click to edit"
              style={{
                cursor: 'pointer',
                fontSize: isSmallCentered ? 10 : 11,
                lineHeight: 1.6,
                color: rendered ? '#1e293b' : '#94a3b8',
                fontStyle: rendered ? 'normal' : 'italic',
                whiteSpace: 'pre-wrap',
                marginTop: 4,
              }}
            >
              {rendered || '(empty — click to add content)'}
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 6,
                fontSize: 9,
                color: '#94a3b8',
                gap: 6,
                flexWrap: 'wrap',
                textAlign: 'left',
              }}
            >
              <span>
                📍 {t.position} &nbsp;·&nbsp; {lastEditLabel(t)}
              </span>
              <span style={{ display: 'flex', gap: 10 }}>
                <span
                  onClick={() => startEdit(t)}
                  style={{ cursor: 'pointer', color: 'var(--cyan)' }}
                >
                  <Pencil size={11} className="inline" /> Edit
                </span>
                {t.revisionCount > 0 ? (
                  <span
                    onClick={() => setRevisionsKey(t.templateKey)}
                    style={{ cursor: 'pointer', color: 'var(--cyan)', textDecoration: 'underline' }}
                  >
                    🕐 {t.revisionCount} revision{t.revisionCount > 1 ? 's' : ''}
                  </span>
                ) : null}
                {t.isCustomised ? (
                  <span
                    onClick={() => resetBlock(t.templateKey)}
                    style={{ cursor: 'pointer', color: 'var(--red)', textDecoration: 'underline' }}
                  >
                    ↺ Reset to default
                  </span>
                ) : null}
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="section-hdr" style={{ marginBottom: 8 }}>
        📄 Print Templates — WYSIWYG Editor
      </div>
      <div
        className="text3"
        style={{
          fontSize: 12,
          marginBottom: 14,
          padding: '10px 14px',
          background: 'var(--sig-info-bg)',
          border: '1px solid var(--sig-info-bd)',
          borderRadius: 6,
        }}
      >
        <b style={{ color: 'var(--sig-info)' }}>How this works:</b> The document below shows how your
        printed output will look (with sample data). <b>Click any highlighted section</b> to edit it.
        Use variables like <span className="mono">{'{poNo}'}</span> from the right panel to insert real
        data automatically. Changes apply to next print immediately. Last 5 versions are kept for
        rollback.
      </div>

      {/* Doc selector + actions */}
      <div
        className="panel"
        style={{
          padding: '10px 14px',
          marginBottom: 14,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="text3" style={{ fontSize: 11 }}>
            Document:
          </span>
          {PRINT_DOC_TYPES.map((d) => {
            const active = d === doc;
            return (
              <button
                key={d}
                type="button"
                onClick={() => {
                  if (editingKey && !window.confirm('Discard the unsaved edit and switch document?'))
                    return;
                  cancelEdit();
                  setDoc(d);
                }}
                style={{
                  padding: '6px 14px',
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 5,
                  cursor: 'pointer',
                  border: `1px solid ${active ? DOC_COLOR[d] : 'var(--border)'}`,
                  background: active ? DOC_COLOR[d] : 'transparent',
                  color: active ? '#fff' : 'var(--text2)',
                }}
              >
                {DOC_LABEL[d]}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (!openTestPrint(doc, allTemplates)) window.alert('Allow popups to print.');
            }}
          >
            <Printer size={13} /> Test Print
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="inline h-4 w-4 animate-spin" /> Loading templates…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            Failed to load print templates.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 14, alignItems: 'start' }}>
          {/* LEFT — document mock */}
          <div
            className="panel"
            style={{ padding: 0, background: '#fff', color: '#1e293b', borderRadius: 6, overflow: 'hidden' }}
          >
            <div style={{ padding: 0, border: '2px solid #333' }}>
              {/* Header: logo + company */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: 14,
                  borderBottom: '2px solid #333',
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 900,
                    color: '#1E4DB3',
                    marginRight: 18,
                    letterSpacing: -1,
                  }}
                >
                  INNOVIC
                </div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#1E4DB3', letterSpacing: 1 }}>
                    {sample.companyName}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                    {sample.companyAddress}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                    GSTIN: {sample.companyGSTIN}
                    {sample.companyPhone ? `   Phone: ${sample.companyPhone}` : ''}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>
                    E-Mail: {sample.companyEmail}
                  </div>
                </div>
              </div>

              {/* Document title bar */}
              <div
                style={{
                  textAlign: 'center',
                  padding: 10,
                  borderBottom: '2px solid #333',
                  fontSize: 18,
                  fontWeight: 900,
                  letterSpacing: 3,
                  color: DOC_COLOR[doc],
                  background: '#f8fafc',
                }}
              >
                {DOC_TITLE[doc]}
              </div>

              {/* Meta info row (sample) */}
              {isPo ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    borderBottom: '1px solid #999',
                  }}
                >
                  <div style={{ padding: '10px 14px', borderRight: '1px solid #999', fontSize: 11 }}>
                    <b>{doc === 'PO' ? 'PO No.:' : 'SPO No.:'}</b> {doc === 'PO' ? sample.poNo : sample.spoNo}
                    <br />
                    <b>{doc === 'PO' ? 'PO Date:' : 'SPO Date:'}</b>{' '}
                    {doc === 'PO' ? sample.poDate : sample.spoDate}
                    <br />
                    <b>Payment:</b> {sample.paymentTerms}
                  </div>
                  <div style={{ padding: '10px 14px', fontSize: 11 }}>
                    <b>Vendor:</b> {sample.vendorName}
                    <br />
                    <b>GSTIN:</b> {sample.vendorGSTIN}
                    <br />
                    <b>Address:</b> {sample.vendorAddress}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    borderBottom: '1px solid #999',
                  }}
                >
                  <div style={{ padding: '10px 14px', borderRight: '1px solid #999', fontSize: 11 }}>
                    <b>DC No.:</b> {sample.dcNo}
                    <br />
                    <b>DC Date:</b> {sample.dcDate}
                    <br />
                    <b>Purpose:</b> {sample.purpose}
                  </div>
                  <div style={{ padding: '10px 14px', fontSize: 11 }}>
                    <b>Recipient:</b> {sample.recipientName}
                    <br />
                    <b>Vehicle:</b> {sample.vehicleNo}
                    <br />
                    <b>Linked PO:</b> {sample.linkedPONo}
                  </div>
                </div>
              )}

              {/* EDITABLE BLOCK 1: Header Note */}
              {renderBlock(blockOf('header_note'))}

              {/* Sample items table (NOT editable — system-generated) */}
              <div style={{ borderBottom: '1px solid #999' }}>
                <div
                  style={{
                    padding: '6px 14px',
                    background: '#f1f5f9',
                    fontSize: 9,
                    color: '#64748b',
                    fontWeight: 700,
                    letterSpacing: '.04em',
                    borderBottom: '1px solid #cbd5e1',
                  }}
                >
                  SYSTEM-GENERATED — LINE ITEMS TABLE
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'center', width: 30 }}>
                        #
                      </th>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'left' }}>Item</th>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'right', width: 60 }}>
                        Qty
                      </th>
                      {isPo ? (
                        <>
                          <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'right', width: 80 }}>
                            Rate
                          </th>
                          <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'right', width: 90 }}>
                            Amount
                          </th>
                        </>
                      ) : (
                        <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'left', width: 60 }}>
                          UOM
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'center' }}>1</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>
                        Sample Item — Steel Plate 6mm
                      </td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>100</td>
                      {isPo ? (
                        <>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            500.00
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            50,000.00
                          </td>
                        </>
                      ) : (
                        <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>NOS</td>
                      )}
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'center' }}>2</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>
                        Sample Item — Bearings 6203
                      </td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>100</td>
                      {isPo ? (
                        <>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            500.00
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            50,000.00
                          </td>
                        </>
                      ) : (
                        <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>NOS</td>
                      )}
                    </tr>
                    {isPo ? (
                      <tr style={{ background: '#f8fafc' }}>
                        <td
                          colSpan={4}
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontWeight: 700,
                          }}
                        >
                          TOTAL
                        </td>
                        <td
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontWeight: 800,
                          }}
                        >
                          ₹ {sample.totalValue}
                        </td>
                      </tr>
                    ) : (
                      <tr style={{ background: '#f8fafc' }}>
                        <td
                          colSpan={2}
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontWeight: 700,
                          }}
                        >
                          TOTAL QTY
                        </td>
                        <td
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontWeight: 800,
                          }}
                        >
                          {sample.totalQty}
                        </td>
                        <td style={{ padding: 6, border: '1px solid #cbd5e1' }} />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* PO-only: Amount in words */}
              {isPo ? (
                <div
                  style={{
                    padding: '8px 14px',
                    borderBottom: '1px solid #999',
                    fontSize: 10,
                    background: '#fafafa',
                  }}
                >
                  <b>Amount in Words:</b> <i>One Lakh Rupees Only</i>
                </div>
              ) : null}

              {/* EDITABLE BLOCK 2: Special Notes */}
              {renderBlock(blockOf('special_notes'))}
              {/* EDITABLE BLOCK 3: Terms & Conditions */}
              {renderBlock(blockOf('terms'))}
              {/* EDITABLE BLOCK 4: Footer */}
              {renderBlock(blockOf('footer'), { isSmallCentered: true })}

              {/* EDITABLE BLOCK 5: Signature */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: 0,
                  borderTop: '1px solid #999',
                }}
              >
                <div
                  style={{ padding: 14, fontSize: 10, borderRight: '1px solid #999', flex: 1 }}
                >
                  PAN: AQKPM4121A
                  <br />
                  <span style={{ fontStyle: 'italic', color: '#666' }}>E. &amp; O.E.</span>
                </div>
                <div style={{ flex: 1, padding: 0 }}>
                  {renderBlock(blockOf('signature'), { isSignature: true })}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — variables panel */}
          <div style={{ position: 'sticky', top: 14 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div className="fw-700" style={{ fontSize: 12, marginBottom: 6 }}>
                📋 Available Variables
              </div>
              <div className="text3" style={{ fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
                {editingKey
                  ? 'Click any variable to insert at cursor in the editor below.'
                  : 'Click a section in the document to start editing, then variables become clickable.'}
              </div>
              {/* Legacy .pt-vars-panel / .pt-var-chip (L191-193) are not in our
                  theme — computed styles mirrored inline against our tokens. */}
              <div
                style={{
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 8,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  maxHeight: 250,
                  overflowY: 'auto',
                }}
              >
                {allowedVars.map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!editingKey}
                    onClick={() => insertVar(v)}
                    className="mono"
                    style={{
                      fontSize: 10,
                      padding: '3px 8px',
                      borderRadius: 3,
                      fontWeight: 700,
                      border: '1px solid var(--sig-info-bd)',
                      background: 'var(--sig-info-bg)',
                      color: 'var(--sig-info)',
                      cursor: editingKey ? 'pointer' : 'not-allowed',
                      opacity: editingKey ? 1 : 0.5,
                    }}
                    title={editingKey ? 'Click to insert' : 'Click a section to edit first'}
                  >
                    {`{${v}}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="panel text2" style={{ padding: 14, marginTop: 10, fontSize: 10, lineHeight: 1.6 }}>
              <div className="fw-700" style={{ fontSize: 11, marginBottom: 6 }}>
                💡 Quick Tips
              </div>
              <div style={{ marginBottom: 4 }}>
                <b>✎</b> Click a block to edit inline
              </div>
              <div style={{ marginBottom: 4 }}>
                <b>💾</b> Save commits the change
              </div>
              <div style={{ marginBottom: 4 }}>
                <b>🖨</b> Test Print uses sample data
              </div>
              <div>
                <b>↺</b> Reset to default reverts to factory text
              </div>
            </div>
          </div>
        </div>
      )}

      {revisionsKey ? (
        <RevisionsModal
          templateKey={revisionsKey}
          blockName={docTemplates.find((t) => t.templateKey === revisionsKey)?.name ?? revisionsKey}
          onClose={() => setRevisionsKey(null)}
          onRestore={(content) => {
            const t = docTemplates.find((x) => x.templateKey === revisionsKey);
            if (t) {
              setEditingKey(t.templateKey);
              setDraft(content);
            }
            setRevisionsKey(null);
          }}
        />
      ) : null}
    </div>
  );
}
