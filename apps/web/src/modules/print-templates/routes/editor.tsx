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
import { Fragment, useMemo, useRef, useState } from 'react';
import { INNOVIC_LOGO_DATA_URI } from '@/lib/print/letterhead-logo';
import type { SheetField } from '@/lib/print/sheet-print';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePrintTemplates, useRestorePrintTemplateDefault, useSavePrintTemplate } from '../api';
import { RevisionsModal } from '../components/revisions-modal';
import {
  GRN_SAMPLE_LINES,
  PO_SAMPLE_LINES,
  openTestPrint,
  poSampleOrder,
  poSampleRecipient,
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
  // The Purchase Order previews the SHARED SHEET (@/lib/print/sheet-print) —
  // the layout the two delivery challans print on, which the PO moved onto on
  // 2026-09-09. The mock below shows that sheet, so what the admin sees on
  // screen is what Test Print puts on paper. The Service PO, the two challans
  // and the GRN keep the layout they have always previewed.
  const isPoSheet = doc === 'PO';
  // The printed document sets every code, date and number in a monospace face;
  // the mock does the same so the preview reads like the paper.
  const MONO = "'DejaVu Sans Mono', Consolas, 'Courier New', monospace";
  // The sheet's own rule, band and label face (see the stylesheet in
  // @/lib/print/sheet-print) so the preview and the paper cannot drift apart.
  const PO_RULE = '1px solid #1A1A1A';
  const PO_BAND = '#F1F1F1';
  const PO_LABEL_FACE = '"Arial Narrow", Arial, sans-serif';
  const poCell: React.CSSProperties = {
    padding: '6px 9px',
    borderBottom: PO_RULE,
    borderRight: PO_RULE,
    verticalAlign: 'top',
  };
  const poMoneyCell: React.CSSProperties = {
    ...poCell,
    textAlign: 'right',
    fontFamily: MONO,
    whiteSpace: 'nowrap',
  };
  const poSumLabel: React.CSSProperties = {
    padding: '6px 9px',
    borderBottom: PO_RULE,
    borderRight: PO_RULE,
    textAlign: 'right',
    fontFamily: PO_LABEL_FACE,
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: '.08em',
    textTransform: 'uppercase',
    color: '#3A3A3A',
  };
  const poRecipient = poSampleRecipient();
  const poOrder = poSampleOrder();
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
            <div style={{ padding: 0, border: isPoSheet ? PO_RULE : '2px solid #333' }}>
              {isPoSheet ? (
                /* THE SHARED SHEET. Since 2026-09-09 the Purchase Order prints
                   on @/lib/print/sheet-print — the same layout as the two
                   delivery challans: letterhead, blue rule, centred title, the
                   Vendor / Order boxes, the priced goods table and the money
                   rows. ONE outer border, every cell divided by the same 1px
                   rule; no inner box around the goods table. Same sample
                   vendor, lines and totals the PO Test Print puts on paper. */
                <>
                  {/* 1-3. Letterhead, blue rule, centred document title. */}
                  <div style={{ padding: '13px 18px 9px' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'space-between',
                        gap: 22,
                      }}
                    >
                      <img src={INNOVIC_LOGO_DATA_URI} alt="INNOVIC" style={{ height: 44 }} />
                      <div style={{ textAlign: 'right', lineHeight: 1.35, color: '#1A1A1A' }}>
                        <div
                          style={{
                            fontSize: 20,
                            fontWeight: 700,
                            color: '#1E4DB3',
                            lineHeight: 1.1,
                            marginBottom: 3,
                          }}
                        >
                          {sample.companyName}
                        </div>
                        <div style={{ fontSize: 10 }}>{sample.companyAddress}</div>
                        <div style={{ fontSize: 10 }}>
                          e-mail: {sample.companyEmail} &nbsp;&middot;&nbsp; M: {sample.companyPhone}
                        </div>
                        <div style={{ fontSize: 10 }}>
                          <b>GSTIN:</b> {sample.companyGSTIN} &nbsp;&middot;&nbsp; <b>PAN:</b>{' '}
                          AQKPM4121A
                        </div>
                      </div>
                    </div>
                    <div style={{ height: 4, background: '#1E4DB3', margin: '7px 0 8px' }} />
                    <div
                      style={{
                        textAlign: 'center',
                        fontFamily: PO_LABEL_FACE,
                        fontSize: 16,
                        fontWeight: 700,
                        letterSpacing: '.15em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {DOC_TITLE[doc]}
                    </div>
                  </div>

                  {/* 4. Vendor / Supplier and Order, side by side with one
                      vertical rule between them. */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      borderTop: PO_RULE,
                      borderBottom: PO_RULE,
                    }}
                  >
                    {(
                      [
                        ['Vendor / Supplier', poRecipient],
                        ['Order', poOrder],
                      ] as [string, SheetField[]][]
                    ).map(([boxLabel, fields], i) => (
                      <div
                        key={boxLabel}
                        style={{ padding: '11px 16px', borderRight: i === 0 ? PO_RULE : undefined }}
                      >
                        <div
                          style={{
                            fontFamily: PO_LABEL_FACE,
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '.13em',
                            textTransform: 'uppercase',
                            color: '#3A3A3A',
                            paddingBottom: 3,
                            marginBottom: 7,
                            borderBottom: '1px solid #8A8A8A',
                          }}
                        >
                          {boxLabel}
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '104px 1fr',
                            gap: '5px 12px',
                            fontSize: 12,
                          }}
                        >
                          {fields.map((f) => (
                            <Fragment key={f.label}>
                              <div
                                style={{
                                  fontFamily: PO_LABEL_FACE,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  letterSpacing: '.05em',
                                  textTransform: 'uppercase',
                                  color: '#3A3A3A',
                                }}
                              >
                                {f.label}
                              </div>
                              <div
                                style={{
                                  minWidth: 0,
                                  lineHeight: 1.3,
                                  fontFamily: f.variant === 'mono' ? MONO : undefined,
                                  fontSize: f.variant === 'name' ? 15 : 12,
                                  fontWeight: f.variant === 'name' || f.strong ? 700 : undefined,
                                }}
                              >
                                {[f.value, ...(f.extra ?? [])].filter(Boolean).map((line) => (
                                  <div key={line}>{line}</div>
                                ))}
                              </div>
                            </Fragment>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 5-8. The goods table (NOT editable — system-generated):
                      column band, one row per line, the quantity total, then
                      the money rows. */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: PO_BAND }}>
                        {(
                          [
                            ['Sr', 34, 'center'],
                            ['Item detail', 0, 'left'],
                            ['UOM', 46, 'center'],
                            ['Qty', 58, 'center'],
                            ['Rate', 78, 'center'],
                            ['Amount', 92, 'center'],
                          ] as [string, number, 'left' | 'center'][]
                        ).map(([colLabel, w, align], i) => (
                          <th
                            key={colLabel}
                            style={{
                              padding: '6px 9px',
                              borderBottom: PO_RULE,
                              borderRight: i < 5 ? PO_RULE : 'none',
                              fontFamily: PO_LABEL_FACE,
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: '.08em',
                              textTransform: 'uppercase',
                              textAlign: align,
                              ...(w ? { width: w } : {}),
                            }}
                          >
                            {colLabel}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PO_SAMPLE_LINES.map((l, i) => (
                        <tr key={l.itemCode}>
                          <td style={{ ...poCell, textAlign: 'center', fontFamily: MONO }}>
                            {i + 1}
                          </td>
                          <td style={poCell}>
                            <span
                              style={{
                                display: 'block',
                                fontFamily: MONO,
                                fontSize: 11,
                                color: '#3A3A3A',
                              }}
                            >
                              {l.itemCode}
                            </span>
                            <span
                              style={{
                                display: 'block',
                                fontWeight: 600,
                                fontSize: 12.5,
                                lineHeight: 1.25,
                                marginTop: 1,
                              }}
                            >
                              {l.itemName}
                            </span>
                            {l.description ? (
                              <span
                                style={{
                                  display: 'block',
                                  fontSize: 11,
                                  lineHeight: 1.4,
                                  color: '#3A3A3A',
                                  marginTop: 2,
                                }}
                              >
                                <b
                                  style={{
                                    fontFamily: PO_LABEL_FACE,
                                    fontSize: 10,
                                    letterSpacing: '.05em',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  Description
                                </b>{' '}
                                {l.description}
                              </span>
                            ) : null}
                          </td>
                          <td style={{ ...poCell, textAlign: 'center' }}>{l.uom}</td>
                          <td
                            style={{
                              ...poCell,
                              textAlign: 'right',
                              fontFamily: MONO,
                              fontWeight: 600,
                            }}
                          >
                            {l.qty}
                          </td>
                          <td style={poMoneyCell}>{l.rate}</td>
                          <td style={{ ...poMoneyCell, borderRight: 'none' }}>{l.amount}</td>
                        </tr>
                      ))}
                      <tr style={{ background: PO_BAND }}>
                        <td colSpan={3} style={{ ...poSumLabel, fontSize: 13, color: '#1A1A1A' }}>
                          Total quantity &mdash; {PO_SAMPLE_LINES.length} line
                          {PO_SAMPLE_LINES.length === 1 ? '' : 's'}
                        </td>
                        <td
                          style={{
                            ...poCell,
                            textAlign: 'right',
                            fontFamily: MONO,
                            fontWeight: 700,
                          }}
                        >
                          {sample.totalQty}
                        </td>
                        <td style={{ ...poCell, textAlign: 'center', fontWeight: 700 }}>NOS</td>
                        <td style={{ ...poCell, borderRight: 'none' }} />
                      </tr>
                      {(
                        [
                          ['Subtotal', '1,00,000.00', false],
                          ['SGST @ 9%', '9,000.00', false],
                          ['CGST @ 9%', '9,000.00', false],
                          ['Total', `₹ ${sample.totalValue}`, true],
                        ] as [string, string, boolean][]
                      ).map(([sumLabel, value, isGrand]) => (
                        <tr key={sumLabel} style={isGrand ? { background: PO_BAND } : undefined}>
                          <td
                            colSpan={5}
                            style={{
                              ...poSumLabel,
                              ...(isGrand ? { fontSize: 13, color: '#1A1A1A' } : {}),
                            }}
                          >
                            {sumLabel}
                          </td>
                          <td
                            style={{
                              ...poMoneyCell,
                              borderRight: 'none',
                              fontWeight: isGrand ? 700 : 400,
                              ...(isGrand ? { fontSize: 13 } : {}),
                            }}
                          >
                            {value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 9. Amount chargeable (in words). */}
                  <div style={{ padding: '8px 14px', borderBottom: PO_RULE, fontSize: 11 }}>
                    <b
                      style={{
                        fontFamily: PO_LABEL_FACE,
                        fontSize: 10,
                        letterSpacing: '.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Amount chargeable (in words)
                    </b>
                    <br />
                    <i>Indian Rupees One Lakh Eighteen Thousand Only</i>
                  </div>
                </>
              ) : (
                <>
                {/* Header: the letterhead the Service PO, the two delivery
                    challans and the GRN still preview. The Purchase Order has
                    its own, on the shared sheet, above. */}
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
                {isGrn ? (
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
                  {isGrn ? (
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

                {/* Service PO only: Amount in words */}
                {isPo ? (
                  <div
                    style={{
                      padding: '8px 14px',
                      borderBottom: '1px solid #999',
                      fontSize: 10,
                      background: '#fafafa',
                    }}
                  >
                    <b>Amount in Words:</b>{' '}
                    <i>One Lakh Rupees Only</i>
                  </div>
                ) : null}
                </>
              )}

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
