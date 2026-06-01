// Print Templates — admin-only WYSIWYG editor. Mirror of legacy
// renderPrintTemplates (L14660). Three docs (PO / OSP DC / JW DC), 5 editable
// blocks each, variable insertion, last-5 revision rollback, test print.
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
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber)' }}>
          🔒 Admin access required — Print Templates can be edited only by Admin users.
        </div>
      </div>
    );
  }

  function renderBlock(t: EffectivePrintTemplate): React.JSX.Element {
    const isEditing = editingKey === t.templateKey;
    const customised = t.isCustomised;
    const rendered = substituteTemplateVars(t.content, sample);
    return (
      <div
        key={t.templateKey}
        style={{
          position: 'relative',
          border: `2px ${isEditing ? 'solid #d97706' : customised ? 'solid #16a34a' : 'dashed #cbd5e1'}`,
          background: isEditing ? '#fffbeb' : customised ? '#f0fdf4' : '#fafafa',
          borderRadius: 4,
          margin: '10px 0',
          padding: '14px 14px 10px',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -9,
            left: 10,
            background: isEditing ? '#d97706' : customised ? '#16a34a' : '#94a3b8',
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
                minHeight: 130,
                marginTop: 6,
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontFamily: 'var(--mono)',
                fontSize: 13,
                background: '#fff',
                color: '#1e293b',
                resize: 'vertical',
              }}
            />
            {unknownVars.length > 0 ? (
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--amber)' }}>
                ⚠ Unknown variable{unknownVars.length > 1 ? 's' : ''}:{' '}
                {unknownVars.map((v) => `{${v}}`).join(' ')} — will print as blank
              </div>
            ) : null}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 8,
                gap: 6,
              }}
            >
              <span className="text3" style={{ fontSize: 10 }}>
                Tip: click variables on the right to insert at cursor.
              </span>
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
          </>
        ) : (
          <>
            <div
              onClick={() => startEdit(t)}
              title="Click to edit"
              style={{
                cursor: 'pointer',
                fontSize: 11,
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
                marginTop: 8,
                fontSize: 9,
                color: '#94a3b8',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <span>
                📍 {t.position}
                {' · '}
                {t.isCustomised
                  ? `Edited by ${t.lastEditedBy ?? '?'}`
                  : 'Factory default'}
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
      <div className="section-hdr" style={{ marginBottom: 6 }}>
        📄 Print Templates — WYSIWYG Editor
      </div>
      <div
        className="text3"
        style={{
          fontSize: 11,
          marginBottom: 14,
          padding: '10px 14px',
          background: 'var(--bg3)',
          border: '1px solid var(--border)',
          borderRadius: 6,
        }}
      >
        Customise the editable blocks of each printed document. The company header and the line-items
        table are system-generated; only the prose below is editable. Use variables like{' '}
        <span className="mono">{'{poNo}'}</span> from the right panel. Changes apply to the next print
        immediately. The last 5 versions of each block are kept for rollback.
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
          <div className="panel" style={{ padding: 16, background: '#fff' }}>
            <div
              style={{
                textAlign: 'center',
                paddingBottom: 8,
                borderBottom: `2px solid ${DOC_COLOR[doc]}`,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: DOC_COLOR[doc] }}>
                INNOVIC TECHNOLOGY
              </div>
              <div style={{ fontSize: 10, color: '#475569' }}>{sample.companyAddress}</div>
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 2, color: DOC_COLOR[doc], marginTop: 6 }}>
                {DOC_LABEL[doc].toUpperCase()}
              </div>
            </div>

            {docTemplates
              .filter((t) => t.block === 'header_note')
              .map((t) => renderBlock(t))}

            <div
              style={{
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                padding: 8,
                margin: '10px 0',
                fontSize: 10,
                color: '#64748b',
                background: '#f8fafc',
                textAlign: 'center',
              }}
            >
              SYSTEM-GENERATED — LINE ITEMS TABLE (not editable)
            </div>

            {docTemplates
              .filter((t) => ['special_notes', 'terms', 'footer', 'signature'].includes(t.block))
              .map((t) => renderBlock(t))}
          </div>

          {/* RIGHT — variables panel */}
          <div style={{ position: 'sticky', top: 14 }}>
            <div className="panel" style={{ padding: 14 }}>
              <div className="fw-700" style={{ fontSize: 12, marginBottom: 6 }}>
                📋 Available Variables
              </div>
              <div className="text3" style={{ fontSize: 10, marginBottom: 10, lineHeight: 1.5 }}>
                {editingKey
                  ? 'Click a variable to insert at the cursor.'
                  : 'Click a block to edit, then variables become clickable.'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {allowedVars.map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!editingKey}
                    onClick={() => insertVar(v)}
                    className="mono"
                    style={{
                      fontSize: 10,
                      padding: '2px 7px',
                      borderRadius: 4,
                      border: '1px solid var(--border)',
                      background: editingKey ? 'var(--bg3)' : 'transparent',
                      color: editingKey ? 'var(--cyan)' : 'var(--text3)',
                      cursor: editingKey ? 'pointer' : 'not-allowed',
                    }}
                    title={editingKey ? 'Click to insert' : 'Click a block to edit first'}
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
              <div>✎ Click a block to edit inline</div>
              <div>💾 Save commits the change (admin only)</div>
              <div>🖨 Test Print uses sample data</div>
              <div>↺ Reset reverts to factory text</div>
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
