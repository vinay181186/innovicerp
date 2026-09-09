// Print Templates — admin-only WYSIWYG editor. Mirror of legacy
// renderPrintTemplates (L14660) + _pteRenderBlock (L14819). Legacy's 3 docs
// (PO / OSP DC / JW DC) plus our SERVICE PO, 4 editable blocks each, variable
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
import { INNOVIC_LOGO_DATA_URI } from '@/lib/print/letterhead-logo';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePrintTemplates, useRestorePrintTemplateDefault, useSavePrintTemplate } from '../api';
import { RevisionsModal } from '../components/revisions-modal';
import {
  GRN_SAMPLE_LINES,
  PO_SAMPLE_LINES,
  PO_SAMPLE_PARTIES,
  openTestPrint,
  poSampleDocRow,
  sampleDataFor,
} from '../lib/test-print';

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
  // The GRN is the one INWARD document here — green, the app's "accepted /
  // received" tone. Taken from the theme token so it tracks the palette; the
  // four literals above predate the tokens and are left as they are.
  GRN: 'var(--green)',
};
const DOC_LABEL: Record<PrintDocType, string> = {
  PO: 'Purchase Order',
  'SERVICE PO': 'Service Purchase Order',
  'OSP DC': 'OSP Delivery Challan',
  'JW DC': 'Job Work DC',
  GRN: 'Goods Receipt Note',
};
// Title printed on the document itself (legacy titleText L14708). Distinct from
// the selector button label — legacy's "Job Work DC" button prints as
// "JOB WORK DELIVERY CHALLAN". Mirrors DOC_TITLE in @/lib/print/doc-print.
const DOC_TITLE: Record<PrintDocType, string> = {
  PO: 'PURCHASE ORDER',
  'SERVICE PO': 'SERVICE PURCHASE ORDER',
  'OSP DC': 'OSP DELIVERY CHALLAN',
  'JW DC': 'JOB WORK DELIVERY CHALLAN',
  GRN: 'GOODS RECEIPT NOTE',
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
  // The GRN is a THIRD shape, not a variant of either: it is an inward receipt,
  // so it prints received / accepted / rejected quantities and NO money at all.
  // Mirrors modules/goods-receipt-notes/lib/print-grn.ts, which is the builder
  // that actually puts a GRN on paper.
  const isGrn = doc === 'GRN';
  // The Purchase Order prints the APPROVED FORMAT (sample signed off
  // 2026-09-08): a letterhead that repeats on every page, a five-cell document
  // row, supplier + ship-to boxes, and one "Item Code & Description" column.
  // Mirrors `docLayout: 'v10'` in @/lib/print/doc-print, so this mock shows
  // what actually comes out of the printer. The Service PO, the two challans
  // and the GRN keep the layout they have always previewed.
  const isPoV10 = doc === 'PO';
  // The printed document sets every code, date and number in a monospace face;
  // the mock does the same so the preview reads like the paper.
  const MONO = "'DejaVu Sans Mono', Consolas, 'Courier New', monospace";
  const poDocRow = poSampleDocRow();
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
            // The button sits ABOVE the loading branch, so before this it could
            // be clicked while the templates were still in flight and printed a
            // sample document with every editable block blank.
            disabled={isLoading || allTemplates.length === 0}
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
              {/* Header: the letterhead. On the Purchase Order it is the
                  approved band — logo left, company block right, blue rule —
                  and it is REPEATED at the top of every printed page. */}
              {isPoV10 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '8px 14px',
                    borderBottom: '2px solid #1E4DB3',
                  }}
                >
                  <img src={INNOVIC_LOGO_DATA_URI} alt="INNOVIC" style={{ height: 34 }} />
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div
                      style={{ fontSize: 20, fontWeight: 700, color: '#1E4DB3', lineHeight: 1.25 }}
                    >
                      {sample.companyName}
                    </div>
                    <div style={{ fontSize: 10, color: '#334155', lineHeight: 1.45 }}>
                      {sample.companyAddress}
                    </div>
                    <div style={{ fontSize: 10, color: '#334155', lineHeight: 1.45 }}>
                      <b>GSTIN:</b> {sample.companyGSTIN} &nbsp;·&nbsp; <b>PAN:</b> AQKPM4121A
                    </div>
                  </div>
                </div>
              ) : (
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
              )}

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
              {isPoV10 ? (
                <>
                  {/* The five-cell document row */}
                  <div style={{ display: 'flex', borderBottom: '1px solid #999' }}>
                    {poDocRow.map((c, i) => (
                      <div
                        key={c.label}
                        style={{
                          flex: 1,
                          padding: '5px 10px',
                          borderRight: i < poDocRow.length - 1 ? '1px solid #999' : 'none',
                        }}
                      >
                        <span style={{ fontSize: 11, color: '#666', letterSpacing: '.09em' }}>
                          {c.label}
                        </span>
                        <br />
                        <b style={{ fontSize: 12, fontFamily: c.mono === false ? undefined : MONO }}>
                          {c.value}
                        </b>
                      </div>
                    ))}
                  </div>
                  {/* Vendor / Supplier and Ship To, label column + value column */}
                  <div style={{ display: 'flex', borderBottom: '1px solid #999' }}>
                    {PO_SAMPLE_PARTIES.map((b, i) => (
                      <div
                        key={b.label}
                        style={{
                          flex: 1,
                          padding: '10px 14px',
                          fontSize: 12,
                          lineHeight: 1.45,
                          borderRight: i === 0 ? '1px solid #999' : 'none',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            color: '#333',
                            textDecoration: 'underline',
                            fontSize: 11,
                            letterSpacing: '.11em',
                          }}
                        >
                          {b.label}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
                          {b.name}
                        </div>
                        {b.rows.map((r) => (
                          <div key={r.label} style={{ display: 'flex', gap: 10, marginTop: 3 }}>
                            <b
                              style={{
                                flex: '0 0 118px',
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#475569',
                                letterSpacing: '.07em',
                              }}
                            >
                              {r.label}
                            </b>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: 12,
                                fontFamily: r.mono ? MONO : undefined,
                              }}
                            >
                              {r.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              ) : isGrn ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    borderBottom: '1px solid #999',
                  }}
                >
                  <div
                    style={{ padding: '10px 14px', borderRight: '1px solid #999', fontSize: 11 }}
                  >
                    <b>GRN No.:</b> {sample.grnNo}
                    <br />
                    <b>GRN Date:</b> {sample.grnDate}
                    <br />
                    <b>Vendor:</b> {sample.vendorName}
                  </div>
                  <div style={{ padding: '10px 14px', fontSize: 11 }}>
                    <b>PO No.:</b> {sample.poNo}
                    <br />
                    <b>Vendor DC No.:</b> {sample.dcNo}
                    <br />
                    <b>Invoice No.:</b> {sample.invoiceNo}
                  </div>
                </div>
              ) : isPo ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    borderBottom: '1px solid #999',
                  }}
                >
                  {/* Only the Service PO reaches here now — the Purchase Order
                      has its own branch above, on the approved format. */}
                  <div style={{ padding: '10px 14px', borderRight: '1px solid #999', fontSize: 11 }}>
                    <b>SPO No.:</b> {sample.spoNo}
                    <br />
                    <b>SPO Date:</b> {sample.spoDate}
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
                {isPoV10 ? (
                  // Approved format: ONE column stacks the item code, the item
                  // name and — only when the line has remarks — a
                  // "Description:" line. Same two sample lines the PO Test
                  // Print puts on paper.
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        {(
                          [
                            ['Sr No.', 40],
                            ['Item Code & Description', 0],
                            ['Qty', 52],
                            ['UOM', 46],
                            ['Rate', 82],
                            ['Amount', 96],
                          ] as [string, number][]
                        ).map(([label, w], i) => (
                          <th
                            key={label}
                            style={{
                              padding: 6,
                              border: '1px solid #cbd5e1',
                              fontSize: 11,
                              letterSpacing: '.09em',
                              textAlign: i === 1 ? 'left' : 'center',
                              ...(w ? { width: w } : {}),
                            }}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PO_SAMPLE_LINES.map((l, i) => (
                        <tr key={l.itemCode}>
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'center',
                              fontFamily: MONO,
                            }}
                          >
                            {i + 1}
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>
                            <span
                              style={{
                                display: 'block',
                                fontFamily: MONO,
                                fontWeight: 700,
                                fontSize: 12,
                              }}
                            >
                              {l.itemCode}
                            </span>
                            <span style={{ display: 'block', fontWeight: 700 }}>{l.itemName}</span>
                            {l.description ? (
                              <span
                                style={{
                                  display: 'block',
                                  fontSize: 11,
                                  color: '#475569',
                                  marginTop: 2,
                                }}
                              >
                                <b style={{ color: '#334155' }}>Description:</b> {l.description}
                              </span>
                            ) : null}
                          </td>
                          {[l.qty, l.uom ?? 'NOS'].map((v, k) => (
                            <td
                              key={k}
                              style={{
                                padding: '5px 8px',
                                border: '1px solid #cbd5e1',
                                textAlign: 'center',
                                fontFamily: MONO,
                              }}
                            >
                              {v}
                            </td>
                          ))}
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'right',
                              fontFamily: MONO,
                            }}
                          >
                            {l.rate}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'right',
                              fontFamily: MONO,
                              fontWeight: 700,
                            }}
                          >
                            {l.amount}
                          </td>
                        </tr>
                      ))}
                      {(
                        [
                          ['Subtotal', '1,00,000.00', 700, '#f8fafc'],
                          ['SGST @ 9%', '9,000.00', 400, ''],
                          ['CGST @ 9%', '9,000.00', 400, ''],
                          ['TOTAL', '₹ ' + sample.totalValue, 800, '#f1f5f9'],
                        ] as [string, string, number, string][]
                      ).map(([label, value, weight, bg]) => (
                        <tr key={label} style={bg ? { background: bg } : undefined}>
                          <td
                            colSpan={5}
                            style={{
                              padding: 6,
                              border: '1px solid #cbd5e1',
                              textAlign: 'right',
                              fontWeight: weight,
                            }}
                          >
                            {label}
                          </td>
                          <td
                            style={{
                              padding: 6,
                              border: '1px solid #cbd5e1',
                              textAlign: 'right',
                              fontFamily: MONO,
                              fontWeight: weight,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : isGrn ? (
                  // Received / accepted / rejected — no Rate, no Amount, no
                  // money. Same seven columns, same order, same two sample
                  // lines the GRN test print puts on paper.
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#f1f5f9' }}>
                        <th
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'center',
                            width: 44,
                          }}
                        >
                          Sr No.
                        </th>
                        <th
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'left',
                            width: 110,
                          }}
                        >
                          Item Code
                        </th>
                        <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'left' }}>
                          Item Name
                        </th>
                        <th
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'center',
                            width: 78,
                          }}
                        >
                          Received Qty
                        </th>
                        <th
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'center',
                            width: 78,
                          }}
                        >
                          QC Accepted
                        </th>
                        <th
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'center',
                            width: 78,
                          }}
                        >
                          QC Rejected
                        </th>
                        <th
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'left',
                            width: 90,
                          }}
                        >
                          QC Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {GRN_SAMPLE_LINES.map((l, i) => (
                        <tr key={l.itemCode}>
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'center',
                            }}
                          >
                            {i + 1}
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>
                            {l.itemCode}
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>
                            {l.itemName}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'center',
                              fontWeight: 700,
                            }}
                          >
                            {l.receivedQty}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'center',
                              color: '#16a34a',
                              fontWeight: 700,
                            }}
                          >
                            {l.qcAcceptedQty}
                          </td>
                          <td
                            style={{
                              padding: '5px 8px',
                              border: '1px solid #cbd5e1',
                              textAlign: 'center',
                              color: '#d97706',
                              fontWeight: 700,
                            }}
                          >
                            {l.qcRejectedQty}
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>
                            {l.qcStatus.replaceAll('_', ' ')}
                          </td>
                        </tr>
                      ))}
                      <tr style={{ background: '#f8fafc' }}>
                        <td
                          colSpan={3}
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
                            textAlign: 'center',
                            fontWeight: 800,
                          }}
                        >
                          {sample.totalReceived}
                        </td>
                        <td
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'center',
                            fontWeight: 800,
                            color: '#16a34a',
                          }}
                        >
                          {sample.totalAccepted}
                        </td>
                        <td
                          style={{
                            padding: 6,
                            border: '1px solid #cbd5e1',
                            textAlign: 'center',
                            fontWeight: 800,
                            color: '#d97706',
                          }}
                        >
                          {sample.totalRejected}
                        </td>
                        <td style={{ padding: 6, border: '1px solid #cbd5e1' }} />
                      </tr>
                    </tbody>
                  </table>
                ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9' }}>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'center', width: 44 }}>
                        Sr No.
                      </th>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'left', width: 110 }}>
                        Item Code
                      </th>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'left' }}>Item Name</th>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'right', width: 60 }}>
                        Qty
                      </th>
                      <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'left', width: 60 }}>UOM</th>
                      {isPo ? (
                        <>
                          <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'right', width: 80 }}>
                            Rate
                          </th>
                          <th style={{ padding: 6, border: '1px solid #cbd5e1', textAlign: 'right', width: 90 }}>
                            Amount
                          </th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'center' }}>1</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>STL-PL-6</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>Steel Plate 6mm</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>100</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>NOS</td>
                      {isPo ? (
                        <>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            500.00
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            50,000.00
                          </td>
                        </>
                      ) : null}
                    </tr>
                    <tr>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'center' }}>2</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>BRG-6203</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>Bearings 6203</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>100</td>
                      <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1' }}>NOS</td>
                      {isPo ? (
                        <>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            500.00
                          </td>
                          <td style={{ padding: '5px 8px', border: '1px solid #cbd5e1', textAlign: 'right' }}>
                            50,000.00
                          </td>
                        </>
                      ) : null}
                    </tr>
                    {isPo ? (
                      <tr style={{ background: '#f8fafc' }}>
                        <td
                          colSpan={6}
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
                )}
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
                  <b>{isPoV10 ? 'Amount Chargeable (in words)' : 'Amount in Words:'}</b>{' '}
                  <i>
                    {isPoV10
                      ? 'Indian Rupees One Lakh Eighteen Thousand Only'
                      : 'One Lakh Rupees Only'}
                  </i>
                </div>
              ) : null}

              {/* EDITABLE BLOCK 1: Special Notes */}
              {renderBlock(blockOf('special_notes'))}
              {/* EDITABLE BLOCK 2: Terms & Conditions */}
              {renderBlock(blockOf('terms'))}
              {/* EDITABLE BLOCK 3: Footer */}
              {renderBlock(blockOf('footer'), { isSmallCentered: true })}

              {/* EDITABLE BLOCK 4: Signature */}
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
