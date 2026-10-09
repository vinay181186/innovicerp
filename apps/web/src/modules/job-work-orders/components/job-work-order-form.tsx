// Job Work Order form — header + line items with per-line Rate + Amount.
//
// The header mirrors the Sales Order header for parity (user request): a
// live-checked JWSO No. (DocNumberInput), a server-searched Client picker with
// inline quick-add, GST %, a header Due Date that FILLS every line's Due Date
// when changed (a helper — it is not stored; each line keeps its own date), and
// a Client PO No. that is required OR satisfied by an attached Email Ref.
// Status is server-owned: read-only on edit, never sent.
//
// ADR-203: no material fields in the header. Each line names a master item and
// shows its customer raw material in the "Customer RM" column — the
// `<item code>-RM` item, found or created silently the moment the item is picked
// (POST /job-work-orders/rm-item). Lines already used downstream (`inUse`) lock
// Item / UOM / BOM and cannot be removed — they are short-closed instead.

import {
  type CreateJobWorkOrderInput,
  type JobWorkOrderDetail,
  type JobWorkOrderLine,
  type ListItemsResponse,
  normalizeRevision,
  revisionBackwardsMessage,
  revisionGoesBackwards,
  type SoStatus,
  type UpdateJobWorkOrderInput,
  type Uom,
  UOMS,
} from '@innovic/shared';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFieldArray, useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { DocNumberInput } from '@/components/shared/doc-number-input';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useBomMastersList } from '@/modules/bom-master/api';
import { apiDownload, apiFetch } from '@/lib/api';
import { todayLocal } from '@/lib/date';
import { inrFormat } from '@/lib/print/doc-print';
import { useClientsList } from '@/modules/clients/api';
import { QuickAddClient } from '@/modules/clients/components/quick-add-client';
import { useItemsList } from '@/modules/items/api';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useEnsureJwRmItem } from '../api';
import { parseJwLineFile } from '../lib/import-export';
import { JwLineDrawingCell } from './jw-line-drawing-cell';

interface LineFormValue {
  id?: string | undefined;
  /** Our line number, assigned by the server on save and never reused. Shown,
   *  never sent; a new line has none until it is saved. */
  lineNo?: number | undefined;
  itemId?: string | undefined;
  /** The picked item's code — DISPLAY only (the picker's label). Never sent:
   *  the server snapshots it from `itemId`. */
  itemCodeText: string;
  partName: string;
  material?: string | undefined;
  drawingNo?: string | undefined;
  /** The revision printed on the client's drawing ('A', 'B', '2'). Compulsory on
   *  this form (onValid refuses a blank one), free text, and independent of the
   *  file beside it — a client re-issues a revision without sending a new file,
   *  and the same revision can be re-uploaded after a bad scan. (Migration 0120;
   *  the sales-order line carries the same pair.) */
  revision: string;
  /** Path of the uploaded drawing in the private docs bucket, or null/absent. */
  drawingFilePath?: string | null | undefined;
  uom: Uom;
  orderQty: number;
  rate: number;
  dueDate?: string | undefined;
  /** Assembly line: the BOM whose components make up this part (0086). */
  sourceBomMasterId?: string | undefined;
  /** ADR-203: a downstream document uses this line — Item / UOM / BOM locked,
   *  Remove disabled. Read from the detail; never sent. */
  inUse?: boolean | undefined;
}

interface FormValues {
  header: {
    code: string;
    jwDate: string;
    status: SoStatus;
    gstPercent: number;
    clientId?: string;
    customerName?: string;
    clientPoNo?: string;
    remarks?: string;
    // Header Due Date (UI only) — a helper: changing it fills every line's Due
    // Date, and a new line starts from it. Never sent; due_date lives per line.
    dueDate?: string;
  };
  lines: LineFormValue[];
}

const HEADER_DEFAULTS: FormValues['header'] = {
  code: '',
  jwDate: todayLocal(),
  status: 'open',
  gstPercent: 18,
};
const NEW_LINE: LineFormValue = {
  itemCodeText: '',
  partName: '',
  uom: 'NOS',
  orderQty: 1,
  rate: 0,
  revision: '',
};

/** ADR-177: the Rev box capitalises AS TYPED ('b' shows as 'B' at once), so what
 *  the person sees is what the form holds and the server stores. Wraps the
 *  register() props so the box is upper-cased BEFORE react-hook-form reads it
 *  (its own `onChange` option runs after the read, which would leave the form
 *  value lowercase). The caret is put back where it was so typing in the middle
 *  of "R1" does not jump to the end. Only the case changes — trim and the
 *  character rule stay with the schema / `pattern`. Twin of the SO form's. */
function upperCaseRevField<T extends string>(
  field: UseFormRegisterReturn<T>,
): UseFormRegisterReturn<T> {
  return {
    ...field,
    onChange: (e: { target: HTMLInputElement; type?: unknown }) => {
      const el = e.target;
      const upper = el.value.toUpperCase();
      if (upper !== el.value) {
        const { selectionStart, selectionEnd } = el;
        el.value = upper;
        if (selectionStart !== null && selectionEnd !== null)
          el.setSelectionRange(selectionStart, selectionEnd);
      }
      return field.onChange(e);
    },
  };
}
/** HTML `pattern` mirror of REVISION_PATTERN — the box is already upper-case.
 *  Browsers compile `pattern` with the `v` flag, where `/` and `-` inside a
 *  class must be escaped or the whole pattern is silently ignored. */
const REV_INPUT_PATTERN = '[A-Z0-9][A-Z0-9.\\/\\-]{0,31}';
const REV_INPUT_TITLE = 'Drawing Rev: letters, digits, . - / only';
/** The Customer RM lookup for one order item (ADR-203). */
type RmState =
  | { status: 'loading' }
  | { status: 'ok'; code: string; created: boolean }
  | { status: 'error'; message: string };

/** Why a line's Item / UOM / BOM / Remove are locked (ADR-203 `inUse`). */
const IN_USE_TITLE =
  'Used by a Job Card / Plan / Party GRN / issue / return / invoice — use Short-close on the JWSO page';

/** The line's Customer RM (ADR-203): `<code>-RM ✓` in strong mono once known,
 *  with a small "new" chip when this lookup created it; a muted "…" while it is
 *  being checked; the server's message in red when it was refused (Save is
 *  blocked until the item is re-picked). Blank until an item is picked. */
function CustomerRmCell(props: { rm: RmState | undefined }): React.JSX.Element {
  const { rm } = props;
  if (!rm) return <span className="text3">—</span>;
  if (rm.status === 'loading')
    return (
      <span className="text3" title="Checking the Customer RM…">
        …
      </span>
    );
  if (rm.status === 'error')
    return (
      <span
        role="alert"
        title={rm.message}
        style={{ color: 'var(--red2)', fontSize: 11, whiteSpace: 'normal' }}
      >
        {rm.message}
      </span>
    );
  return (
    <span title={rm.code} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
        {rm.code}
      </span>
      <span aria-label="found" style={{ color: 'var(--green2)' }}>
        ✓
      </span>
      {rm.created ? (
        <span className="badge b-amber" title="Created in Item Master for this line">
          new
        </span>
      ) : null}
    </span>
  );
}

type CreateMode = {
  mode: 'create';
  onSubmit: (values: CreateJobWorkOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  /** Client PO document picked below Client PO No. (uploaded after save). */
  onPoFileChange?: (file: File | null) => void;
  /** Email reference attached against the Client PO (uploaded after save). */
  onEmailFileChange?: (file: File | null) => void;
  /** May this user see money on JWSOs — `effectiveFormPerms(eff,'jw_create')
   *  .price`, the same rule the server applies before sending a JWSO detail
   *  (which the edit form reads as `detail.priceVisible`). */
  priceVisible: boolean;
} & PageHeaderSlot;
type EditMode = {
  mode: 'edit';
  detail: JobWorkOrderDetail;
  onSubmit: (values: UpdateJobWorkOrderInput) => Promise<void> | void;
  submitLabel?: string;
  submitError?: string | null;
  onCancel?: () => void;
  /** Client PO document picked below Client PO No. (uploaded on save). */
  onPoFileChange?: (file: File | null) => void;
  onEmailFileChange?: (file: File | null) => void;
} & PageHeaderSlot;
export type JobWorkOrderFormProps = CreateMode | EditMode;

/** Create-page pattern (ERPNext gap report 2026-09-26): when the route passes a
 *  `pageTitle`, the form renders the page's sticky PageHeader itself — Back,
 *  title, Cancel and the blue Save top-right — and lays each section on its own
 *  Panel. Without it (a route that still wraps the form in its own panel) the
 *  form keeps the flat sections and the Save row at the foot, so it never
 *  renders a panel inside a panel. */
type PageHeaderSlot = {
  pageTitle?: string;
  pageSubtitle?: ReactNode;
  backLabel?: string;
  onBack?: () => void;
};

/** One form section: a Panel on a standalone page, a plain titled block when
 *  the route already wraps the form in a panel. */
function Section({
  standalone,
  title,
  actions,
  table = false,
  children,
}: {
  standalone: boolean;
  title: string;
  actions?: ReactNode;
  table?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  if (standalone) {
    return (
      <Panel
        title={title}
        actions={actions}
        {...(table ? { bodyPadding: 'none' as const, bodyClassName: 'tbl-wrap' } : {})}
      >
        {children}
      </Panel>
    );
  }
  return (
    <div style={{ marginBottom: 'var(--sp-4)' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <h2 className="panel-title">{title}</h2>
        {actions ? (
          <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'center' }}>{actions}</div>
        ) : null}
      </div>
      {table ? (
        <div className="tbl-wrap" style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function JobWorkOrderForm(props: JobWorkOrderFormProps): React.JSX.Element {
  const isEdit = props.mode === 'edit';
  const isCreate = !isEdit;
  const defaults: FormValues = isEdit
    ? detailToFormValues(props.detail)
    : { header: HEADER_DEFAULTS, lines: [{ ...NEW_LINE }] };

  const form = useForm<FormValues>({ defaultValues: defaults });
  const { register, control, handleSubmit, formState, watch, setValue, getValues } = form;
  const errors = formState.errors;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  // ── Searchable client picker (server-searched; scales past the 200 cap) ──
  const [clientSearch, setClientSearch] = useState('');
  // Active customers only (A10) — the server refuses a newly linked inactive
  // one; an edit keeps its current customer's label via clientLabel below.
  const { data: clientsData, isFetching: clientsFetching } = useClientsList({
    ...(clientSearch.trim() ? { search: clientSearch.trim() } : {}),
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const clients = clientsData?.clients ?? [];

  // Active BOMs, offered per line as "Assembly BOM". Deliberately NOT filtered
  // to BOMs free of bought parts — the list endpoint doesn't carry line types,
  // and the server already refuses such a BOM on a job-work order with a
  // message naming the offending parts. Filtering here would hide the reason.
  const { data: bomData } = useBomMastersList({ status: 'active', limit: 200, offset: 0 });
  const jwUsableBoms = bomData?.items ?? [];

  // (The old fixed 200-row item preload that fed a code→item map is gone: the
  // line picker below searches the server and hands the PICKED record straight
  // to pickLineItem, so an item past the first page auto-fills too.)

  // Line Item Code picker: the shared SearchableSelect, server-searched like the
  // SO form's, so a code beyond any first page can still be picked.
  const [lineItemSearch, setLineItemSearch] = useState('');
  const { data: lineItemsData, isFetching: lineItemsFetching } = useItemsList({
    ...(lineItemSearch.trim() ? { search: lineItemSearch.trim() } : {}),
    // excludePartyOwned (ADR-195): a JWSO line is the part we MAKE, so a
    // customer's own -RM material must not be pickable here (it is derived from
    // the picked item and shown in the Customer RM column).
    excludePartyOwned: true,
    limit: 50,
    offset: 0,
  });
  const lineItems = lineItemsData?.items ?? [];

  // ADR-227 — the JWSO No. is not typed here any more (the owner: "dcno, pono,
  // jwso i never type by hand. it i already system generated"), so there is no
  // duplicate check to run, no suggestion to remember and nothing that can stop
  // a save. The field shows the server's next number read-only; the server
  // assigns the real one under its series lock.

  // ── Client select label + inline quick-add ──
  const selectedClientId = watch('header.clientId') ?? null;
  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const [clientLabel, setClientLabel] = useState<string>(
    props.mode === 'edit' ? (props.detail.customerName ?? '') : '',
  );
  const [showAddClient, setShowAddClient] = useState(false);
  function onClientCreated(id: string, label: string): void {
    setValue('header.clientId', id, { shouldValidate: true });
    setClientLabel(label);
    setShowAddClient(false);
  }

  const gstPercent = Number(watch('header.gstPercent')) || 0;

  // Money (rates / amounts / GST / totals) is shown only to a user who may see
  // JWSO prices. Edit: told by the server on the detail it loaded. Create: the
  // route reads the same permission the server checks.
  const priceVisible = isEdit ? props.detail.priceVisible !== false : props.priceVisible;

  // ADR-203: any line already used downstream locks the customer — its Job
  // Cards / Party GRNs / issues were made for this customer.
  const anyLineInUse = isEdit && props.detail.lines.some((l) => l.inUse);
  const savedLineById = new Map<string, JobWorkOrderLine>(
    isEdit ? props.detail.lines.map((l) => [l.id, l] as const) : [],
  );

  // ── Customer RM per order item (ADR-203) ──
  // Keyed by the ORDER item id: the RM is a function of the item alone (one
  // `<code>-RM` per item, any customer), so two lines with the same item share
  // one lookup. Seeded on edit with the RM each line was saved with.
  const [rmByItem, setRmByItem] = useState<Record<string, RmState>>(() => {
    const seed: Record<string, RmState> = {};
    if (props.mode === 'edit') {
      for (const l of props.detail.lines) {
        if (l.itemId && l.rmItemCode)
          seed[l.itemId] = { status: 'ok', code: l.rmItemCode, created: false };
      }
    }
    return seed;
  });
  // Item ids already asked for (or answered) — guards against a second request
  // while the first is still in flight. Cleared for an id to retry it.
  const rmRequested = useRef<Set<string>>(new Set(Object.keys(rmByItem)));
  const ensureRm = useEnsureJwRmItem();
  const ensureRmAsync = ensureRm.mutateAsync;
  function requestRm(itemId: string): void {
    if (rmRequested.current.has(itemId)) return;
    rmRequested.current.add(itemId);
    setRmByItem((prev) => ({ ...prev, [itemId]: { status: 'loading' } }));
    ensureRmAsync({ itemId })
      .then((res) =>
        setRmByItem((prev) => ({
          ...prev,
          [itemId]: { status: 'ok', code: res.rmItemCode, created: res.created },
        })),
      )
      .catch((err: unknown) => {
        // Not cached as answered: re-picking the item asks again.
        rmRequested.current.delete(itemId);
        setRmByItem((prev) => ({
          ...prev,
          [itemId]: {
            status: 'error',
            message: err instanceof Error ? err.message : 'Could not set up the Customer RM.',
          },
        }));
      });
  }

  /** Item Code is the key of a line and must come from Item Master. Picking an
   *  item REPLACES its master-derived fields (Item Name, Material, UOM) and
   *  asks for its Customer RM; clearing it clears them, so nothing stale is
   *  left behind. Rate, Qty, Drawing No., Rev and Due Date are user-entered and
   *  never touched here — the drawing lives on the JWSO line, not the item
   *  master (user decision 2026-09-21). */
  function pickLineItem(idx: number, id: string | null): void {
    const it = id ? lineItems.find((x) => x.id === id) : undefined;
    setValue(`lines.${idx}.itemCodeText`, it?.code ?? '', { shouldDirty: true });
    setValue(`lines.${idx}.itemId`, it?.id);
    setValue(`lines.${idx}.partName`, it?.name ?? '');
    setValue(`lines.${idx}.material`, it?.material ?? '');
    setValue(`lines.${idx}.uom`, it?.uom ?? NEW_LINE.uom);
    if (it) {
      // A failed earlier attempt for this item is retried on a fresh pick.
      if (rmByItem[it.id]?.status === 'error') rmRequested.current.delete(it.id);
      requestRm(it.id);
    }
  }

  /** The header Due Date is a helper: changing it fills every line's Due Date
   *  (the one explicit "apply to all"). Saving never copies it again. */
  function applyDueDateToAllLines(value: string): void {
    const n = getValues('lines')?.length ?? 0;
    for (let i = 0; i < n; i++)
      setValue(`lines.${i}.dueDate`, value || undefined, { shouldDirty: true });
  }

  const watchedLines = watch('lines');
  // Every line's item gets its Customer RM looked up — a picked line already
  // asked in pickLineItem; this catches imported lines and saved lines that
  // pre-date ADR-203 (no RM stored yet). requestRm skips ids already asked.
  const lineItemIdsKey = (watchedLines ?? []).map((l) => l.itemId ?? '').join(',');
  useEffect(() => {
    for (const itemId of lineItemIdsKey.split(',')) if (itemId) requestRm(itemId);
  }, [lineItemIdsKey]);
  const subtotal = (watchedLines ?? []).reduce(
    (s, l) => s + (Number(l.orderQty) || 0) * (Number(l.rate) || 0),
    0,
  );
  const gstAmt = subtotal * (gstPercent / 100);
  const grand = subtotal + gstAmt;
  const lineCount = (watchedLines ?? []).length;
  const totalPcs = (watchedLines ?? []).reduce((s, l) => s + (Number(l.orderQty) || 0), 0);

  // Client PO document upload (#8). File is handed to the parent, which uploads
  // it to Storage + registers metadata against the JWSO after save.
  const poFileRef = useRef<HTMLInputElement>(null);
  const [poFileName, setPoFileName] = useState<string | null>(null);
  const [poFileError, setPoFileError] = useState<string | null>(null);
  const onPoFileChange = 'onPoFileChange' in props ? props.onPoFileChange : undefined;
  function onPickPoFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 20 * 1024 * 1024) {
      setPoFileError('PO document must be 20 MB or smaller.');
      if (poFileRef.current) poFileRef.current.value = '';
      return;
    }
    setPoFileError(null);
    setPoFileName(f?.name ?? null);
    onPoFileChange?.(f);
  }
  function clearPoFile(): void {
    setPoFileName(null);
    setPoFileError(null);
    if (poFileRef.current) poFileRef.current.value = '';
    onPoFileChange?.(null);
  }

  // Email reference attached against the Client PO (parity with the SO form).
  // Keep a local object URL so the just-attached file can be viewed before save.
  const onEmailFileChange = 'onEmailFileChange' in props ? props.onEmailFileChange : undefined;
  const [emailFileName, setEmailFileName] = useState<string | null>(null);
  const [emailFileUrl, setEmailFileUrl] = useState<string | null>(null);
  const [poEmailError, setPoEmailError] = useState<string | null>(null);
  // Line-level rules that react-hook-form cannot express per field (currently the
  // compulsory Rev). Shown as one strip above the Save button, naming the line,
  // so the user is told which row is wrong instead of meeting the API's raw
  // schema rejection. Mirrors the SO form.
  const [lineError, setLineError] = useState<string | null>(null);

  // The Excel Template is built by the API (GET /import-templates/jw-lines.xlsx)
  // so its columns can carry real Excel dropdowns — SheetJS, still used here
  // for READING a filled sheet, silently drops data validation and cannot
  // write one.
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const downloadTemplate = async (): Promise<void> => {
    setTemplateError(null);
    setTemplateBusy(true);
    try {
      await apiDownload('/import-templates/jw-lines.xlsx', {}, 'JW Lines Import Template.xlsx');
    } catch (err) {
      setTemplateError(
        err instanceof Error ? err.message : 'Could not download the template. Try again.',
      );
    } finally {
      setTemplateBusy(false);
    }
  };
  function onPickEmailFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setPoFileError('Email reference file too large (max 20MB).');
      e.target.value = '';
      return;
    }
    if (emailFileUrl) URL.revokeObjectURL(emailFileUrl);
    setEmailFileName(f.name);
    setEmailFileUrl(URL.createObjectURL(f));
    setPoEmailError(null);
    onEmailFileChange?.(f);
  }
  function clearEmailFile(): void {
    if (emailFileUrl) URL.revokeObjectURL(emailFileUrl);
    setEmailFileName(null);
    setEmailFileUrl(null);
    onEmailFileChange?.(null);
  }

  // In-form line import (appends lines to the JW being created/edited).
  const lineFileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  async function onImportLines(file: File): Promise<void> {
    try {
      const { rows, errors: errs } = await parseJwLineFile(file);
      // Every Item Code in the sheet must exist in Item Master (parity with the
      // SO form). No item list is preloaded in memory, so resolve each unique
      // code against the server (search + exact-code match) rather than
      // silently accepting unknown codes as item_id=null.
      const uniqueCodes = Array.from(
        new Set(
          rows
            .map((r) => r.itemCodeText.trim())
            .filter(Boolean)
            .map((c) => c.toUpperCase()),
        ),
      );
      const masterByCode = new Map<string, ListItemsResponse['items'][number]>();
      await Promise.all(
        uniqueCodes.map(async (code) => {
          try {
            const res = await apiFetch<ListItemsResponse>(
              // excludePartyOwned: a customer's own -RM material is never an
              // order line, so a sheet naming one reports it as not found.
              `/items?search=${encodeURIComponent(code)}&excludePartyOwned=true&limit=50&offset=0`,
            );
            const hit = res.items.find((it) => it.code.trim().toUpperCase() === code);
            if (hit) masterByCode.set(code, hit);
          } catch {
            /* leave unresolved → reported as missing below */
          }
        }),
      );

      const missing: string[] = [];
      const newLines: LineFormValue[] = [];
      for (const r of rows) {
        const code = r.itemCodeText.trim();
        const master = code ? masterByCode.get(code.toUpperCase()) : undefined;
        if (!master) {
          if (code) missing.push(code);
          continue;
        }
        // Item Code drives the row: link the master item + auto-fill Part Name
        // and UOM from master; material falls back to master when the sheet
        // cell is blank. Unresolved rows are dropped, never appended.
        newLines.push({
          ...NEW_LINE,
          ...r,
          itemId: master.id,
          itemCodeText: master.code,
          partName: master.name,
          material: r.material ?? master.material ?? '',
          // Drawing No. belongs to THIS order's line, not the item master (user
          // decision 2026-09-21): from the sheet, or blank for the person to type.
          drawingNo: r.drawingNo ?? '',
          // Set explicitly AFTER the `...r` spread, never through it: an absent
          // Rev column spreads `revision: undefined` over the value below. A
          // sheet with no Rev column leaves the box EMPTY, exactly like a
          // hand-added line — the compulsory check then makes the person fill it
          // in rather than letting fifty imported lines inherit a revision that
          // nobody read off a drawing.
          revision: r.revision?.trim() || NEW_LINE.revision,
          uom: master.uom,
          // The sheet's own Due Date per row; a blank cell starts from the
          // header Due Date, like a hand-added line.
          dueDate: r.dueDate ?? (getValues('header.dueDate') || undefined),
        });
      }

      const added = newLines.length;
      if (added) {
        // If the grid still holds only untouched blank starter row(s), replace
        // them so imports fill from Line 1 instead of after an empty row.
        const current = getValues('lines') ?? [];
        const allBlank = current.every(
          (l) => !l.itemId && !l.itemCodeText?.trim() && !l.partName?.trim(),
        );
        if (allBlank) replace(newLines);
        // Each imported line's Customer RM is looked up by the effect above.
        else for (const l of newLines) append(l);
      }

      const parts: string[] = [];
      // Say where the names came from — the sheet no longer has a Part Name
      // column, so it should be obvious the master filled them in.
      if (added) parts.push(`Added ${added} line(s) — Item Name filled from Item Master.`);
      if (missing.length) {
        const uniq = Array.from(new Set(missing));
        parts.push(
          `${uniq.length} item code(s) not found in Item Master: ${uniq.join(', ')}. ` +
            `Please add ${uniq.length > 1 ? 'each' : 'it'} (item code + item name) in Item Master first, then re-import.`,
        );
      }
      if (errs.length) parts.push(`${errs.length} row(s) skipped.`);
      setImportMsg(parts.join(' ') || 'No rows found in the sheet.');
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Could not import file. Try again.');
    } finally {
      if (lineFileRef.current) lineFileRef.current.value = '';
    }
  }

  // Per-line "▸ More" detail row (Material, Drawing No., Drawing File, Assembly
  // BOM), keyed by the react-hook-form field id. Collapsed rows keep their
  // values: react-hook-form holds unmounted fields (shouldUnregister is off).
  const [openMore, setOpenMore] = useState<Set<string>>(() => new Set());
  const toggleMore = (key: string): void =>
    setOpenMore((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onValid = async (values: FormValues): Promise<void> => {
    setPoEmailError(null);
    setLineError(null);
    // Require proof of the client order: a Client PO No. OR an attached email
    // reference (create form only; edit keeps whatever the JWSO already has).
    if (isCreate && !values.header.clientPoNo?.trim() && !emailFileName) {
      setPoEmailError('Enter a Client PO No. or attach an Email Ref — at least one is required.');
      return;
    }

    // Name a line the way the table shows it: its stored Ln, or its row for a
    // line not saved yet (which has no Ln).
    const lineRef = (idx: number): string => {
      const no = values.lines[idx]?.lineNo;
      return no ? `Line ${no}` : `New line (row ${idx + 1})`;
    };

    // Item Code is the key of a JWSO line and must come from Item Master
    // (ADR-203) — the picker and the import both resolve to an itemId.
    const badCode = values.lines.findIndex((l) => !l.itemId);
    if (badCode >= 0) {
      setLineError(`${lineRef(badCode)}: pick the Item Code from Item Master.`);
      return;
    }
    // ADR-203: every line's Customer RM must be settled before Save — still
    // being looked up, or refused by the server (its message is in the row).
    for (let i = 0; i < values.lines.length; i++) {
      const itemId = values.lines[i]?.itemId;
      const rm = itemId ? rmByItem[itemId] : undefined;
      if (!rm || rm.status === 'loading') {
        setLineError(`${lineRef(i)}: still checking the Customer RM — Save again in a moment.`);
        return;
      }
      if (rm.status === 'error') {
        setLineError(`${lineRef(i)}: Customer RM — ${rm.message}`);
        return;
      }
    }
    // Rev is compulsory (migration 0120), exactly as on the Sales Order line.
    // Caught here so the message names the line. Lines loaded for EDIT are never
    // blocked by this: every pre-existing row was backfilled to '0' in the
    // database, and detailToFormValues keeps that '0' (falling back to '0' again
    // if the API has not started sending the column yet) — '0' is non-blank.
    const badRev = values.lines.findIndex((l) => !String(l.revision ?? '').trim());
    if (badRev >= 0) {
      setLineError(
        `${lineRef(badRev)}: enter the Drawing Rev — the revision printed on the customer's drawing.`,
      );
      return;
    }
    // ADR-177: a saved line's Rev never goes backwards (B → A, 2 → 1). Checked
    // here against the revision the JWSO was loaded with, with the same sentence
    // the API answers, so the person is told before the round trip. A change of
    // kind (1 → A) cannot be ordered and is allowed.
    for (const l of values.lines) {
      const saved = l.id ? savedLineById.get(l.id) : undefined;
      if (!saved) continue;
      const typed = String(l.revision ?? '');
      if (revisionGoesBackwards(saved.revision, typed)) {
        setLineError(revisionBackwardsMessage(saved.lineNo, saved.revision, typed));
        return;
      }
    }

    const h = values.header;
    // Built field by field — never a spread of the form header, which also holds
    // UI-only values (the Due Date helper, the read-only status).
    const headerOut = {
      // ADR-227: no `code` on create. The number on screen is a preview and the
      // server numbers the JWSO under its series lock, so a preview that went
      // stale while this screen was open costs nothing — the save takes the next
      // free number instead of being refused as a duplicate.
      ...(isEdit ? { code: h.code } : {}),
      jwDate: h.jwDate,
      clientId: h.clientId || undefined,
      // customerName is snapshotted server-side from the client master.
      // null, not undefined: a field the user cleared must be sent as null to
      // actually clear it (an absent key leaves the stored value as it was).
      clientPoNo: h.clientPoNo?.trim() || null,
      remarks: h.remarks?.trim() || null,
      // Money only from a user who may see it (the server ignores it otherwise).
      ...(priceVisible ? { gstPercent: Number(h.gstPercent) || 0 } : {}),
    };

    const linesOut = values.lines.map((l) => {
      // A line in use keeps its Item / UOM / BOM: the controls are locked, and
      // the saved values are sent so a locked control can never change them.
      const saved = l.id ? savedLineById.get(l.id) : undefined;
      const locked = Boolean(saved?.inUse);
      const itemId = locked && saved?.itemId ? saved.itemId : (l.itemId ?? '');
      const uom = locked && saved ? saved.uom : l.uom;
      const bomId = locked ? (saved?.sourceBomMasterId ?? undefined) : l.sourceBomMasterId;
      return {
        ...(l.id ? { id: l.id } : {}),
        itemId,
        partName: l.partName.trim(),
        // null, not undefined: the server merges only PRESENT keys on update, so
        // a cleared field must be sent as null to actually clear it.
        material: l.material?.trim() || null,
        drawingNo: l.drawingNo?.trim() || null,
        // Always sent, and trimmed. The check above guarantees it is non-blank.
        revision: normalizeRevision(String(l.revision ?? '')),
        // null, not undefined: JSON.stringify drops undefined keys, so clearing a
        // drawing would send nothing at all and the server would keep the old
        // file. An explicit null is what says the drawing was removed.
        drawingFilePath: l.drawingFilePath || null,
        uom,
        orderQty: Number(l.orderQty),
        ...(priceVisible ? { rate: Number(l.rate) || 0 } : {}),
        // Each line's own date — the header Due Date only ever filled these in.
        dueDate: l.dueDate || null,
        ...(bomId ? { sourceBomMasterId: bomId } : {}),
      };
    });

    if (isEdit) {
      const { code: _drop, ...headerNoCode } = headerOut;
      void _drop;
      await props.onSubmit({ header: headerNoCode, lines: linesOut });
    } else {
      await props.onSubmit({ header: headerOut, lines: linesOut } as CreateJobWorkOrderInput);
    }
  };

  // Line table column count: Ln, Item Code, Item Name, Customer RM, Drawing
  // Rev, UOM, Order Qty, [Rate, Amount], Due Date, More, Remove.
  const colCount = priceVisible ? 12 : 10;
  const standalone = Boolean(props.pageTitle);
  // ADR-227: the number can no longer make a save invalid — it is not sent.
  const saveDisabled = formState.isSubmitting;
  const submitForm = handleSubmit(onValid);
  // Ctrl+S runs the same Save as the header button.
  useSaveShortcut(() => void submitForm(), !saveDisabled);
  const cancelButton = props.onCancel ? (
    <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
      Cancel
    </button>
  ) : null;
  // Legacy called this "✓ Save JW" on .btn-success (addJW L12890 / editJW
  // L12926). One Save colour now: blue primary. Same label in both modes.
  const saveButton = (
    <button type="submit" className="btn btn-primary" disabled={saveDisabled}>
      {formState.isSubmitting ? <Loader2 size={13} className="animate-spin" /> : null}
      {formState.isSubmitting
        ? 'Saving…'
        : (props.submitLabel ?? (isCreate ? 'Save JWSO' : 'Save Changes'))}
    </button>
  );
  const errorBanners = (
    <>
      {lineError ? (
        <Banner tone="error" role="alert">
          {lineError}
        </Banner>
      ) : null}
      {props.submitError ? (
        <Banner tone="error" role="alert">
          {props.submitError}
        </Banner>
      ) : null}
    </>
  );

  return (
    <form onSubmit={submitForm}>
      {standalone ? (
        <>
          <PageHeader
            sticky
            title={props.pageTitle ?? ''}
            subtitle={props.pageSubtitle}
            backLabel={props.backLabel}
            onBack={props.onBack ?? props.onCancel}
            dirty={formState.isDirty}
            actions={
              <>
                {cancelButton}
                {saveButton}
              </>
            }
          />
          {/* Errors sit under the header, beside the Save that raised them. */}
          {errorBanners}
        </>
      ) : null}
      {/* Header on the 12-column grid, in reading order: Customer + Client PO
          first, then JWSO No. / dates, GST % and (edit) status, then Remarks.
          No material fields (ADR-203) — each line carries its Customer RM. */}
      <Section standalone={standalone} title="JWSO Details">
        <div className="form-grid-12">
          <div className="form-grp f-lg">
            <label className="form-label">
              Customer<span className="req">★</span>
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <SearchableSelect
                  id="clientId"
                  disabled={anyLineInUse}
                  value={selectedClientId}
                  onChange={(id) => {
                    setValue('header.clientId', id ?? undefined, { shouldValidate: true });
                    const c = clients.find((x) => x.id === id);
                    setClientLabel(c ? `${c.code} — ${c.name}` : '');
                  }}
                  onSearch={setClientSearch}
                  loading={clientsFetching}
                  options={clients.map((c) => ({ id: c.id, code: c.code, name: c.name }))}
                  placeholder="🔍 Type customer code or name…"
                  valueLabel={
                    selectedClient
                      ? `${selectedClient.code} — ${selectedClient.name}`
                      : clientLabel || undefined
                  }
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ whiteSpace: 'nowrap' }}
                disabled={anyLineInUse}
                onClick={() => setShowAddClient(true)}
              >
                + New
              </button>
            </div>
            {anyLineInUse ? (
              <div className="form-help">
                Locked — a line of this JWSO is already used by a Job Card, Party GRN or another
                document.
              </div>
            ) : null}
            <input
              type="hidden"
              {...register('header.clientId', { required: 'Customer is required.' })}
            />
            {errors.header?.clientId?.message ? (
              <div className="form-error">{errors.header.clientId.message}</div>
            ) : null}
          </div>

          <div className="form-grp f-lg">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 4,
              }}
            >
              <label className="form-label" htmlFor="clientPoNo" style={{ marginBottom: 0 }}>
                Client PO No.
              </label>
              <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>or</span>
              {emailFileName ? (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--green2)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  📧{' '}
                  <span
                    style={{
                      maxWidth: 140,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {emailFileName}
                  </span>
                  {emailFileUrl ? (
                    <button
                      type="button"
                      onClick={() => window.open(emailFileUrl, '_blank', 'noopener')}
                      style={{
                        color: 'var(--blue)',
                        fontSize: 11,
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: 0,
                      }}
                    >
                      👁 View
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={clearEmailFile}
                    style={{
                      color: 'var(--red2)',
                      fontSize: 11,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                    }}
                  >
                    ✕
                  </button>
                </span>
              ) : (
                <label
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px dashed var(--border)',
                    color: 'var(--text3)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  📧 Attach Email Ref
                  <input
                    type="file"
                    accept=".eml,.msg,.pdf,.jpg,.jpeg,.png,.webp"
                    style={{ display: 'none' }}
                    onChange={onPickEmailFile}
                  />
                </label>
              )}
            </div>
            <input
              id="clientPoNo"
              className="innovic-input"
              autoComplete="off"
              {...register('header.clientPoNo', {
                onChange: (e) => {
                  if (e.target.value.trim()) setPoEmailError(null);
                },
              })}
            />
            {/* Upload PO Doc (#8) — reflects on the JWSO after save. */}
            <div style={{ marginTop: 6 }}>
              <input
                ref={poFileRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                style={{ display: 'none' }}
                onChange={onPickPoFile}
              />
              {poFileName ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span className="mono" style={{ color: 'var(--blue)' }}>
                    📎 {poFileName}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearPoFile}
                    aria-label="Remove PO document"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => poFileRef.current?.click()}
                >
                  📤 Upload PO Doc
                </button>
              )}
              {poFileError ? <div className="form-error">{poFileError}</div> : null}
            </div>
            {poEmailError ? (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red2)' }}>
                ⚠ {poEmailError}
              </div>
            ) : null}
          </div>

          {/* No ★: `code` is `.optional()` and the server generates the next
            IN-JW-##### in series when omitted — the field's own help text says
            "leave blank to auto-generate on save", and useDocNumber treats empty
            as valid, so nothing enforces a star here. Matches the PO form. */}
          <div className="f-sm">
            {isEdit ? (
              <DocNumberInput
                type="job_work_order"
                label="JWSO No."
                readOnly
                value={watch('header.code') ?? ''}
                onChange={(v) => setValue('header.code', v)}
              />
            ) : (
              <DocNumberInput type="job_work_order" label="JWSO No." preview />
            )}
          </div>
          <div className="form-grp f-sm">
            <label className="form-label" htmlFor="jwDate">
              JWSO Date<span className="req">★</span>
            </label>
            <input
              id="jwDate"
              type="date"
              className="innovic-input"
              {...register('header.jwDate', { required: 'JWSO Date is required.' })}
            />
          </div>
          <div className="form-grp f-sm">
            <label className="form-label" htmlFor="jwDueDate">
              Due Date
            </label>
            <input
              id="jwDueDate"
              type="date"
              className="innovic-input"
              title="Fills every line's Due Date. Each line can then be changed on its own."
              {...register('header.dueDate', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  applyDueDateToAllLines(e.target.value),
              })}
            />
            <div className="form-help">Fills every line&apos;s Due Date</div>
          </div>
          {priceVisible ? (
            <div className="form-grp f-sm">
              <label className="form-label" htmlFor="gstPercent">
                GST %
              </label>
              <select
                id="gstPercent"
                className="innovic-select"
                {...register('header.gstPercent', { valueAsNumber: true })}
              >
                {[0, 5, 12, 18, 28].map((g) => (
                  <option key={g} value={g}>
                    {g}%
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {isEdit ? (
            <div className="form-grp f-sm">
              <label className="form-label" htmlFor="status">
                JWSO Status
              </label>
              {/* Status is read-only on edit: it is driven by the JC-completion
                cascade (open→closed), the JW-Return cascade (→dispatched) and
                soft-delete for cancel — a manual edit only causes drift, and the
                server ignores any status in the update payload. */}
              <input
                id="status"
                className="innovic-input"
                readOnly
                {...register('header.status')}
              />
            </div>
          ) : null}

          <div className="form-grp f-full">
            <label className="form-label" htmlFor="remarks">
              Remarks
            </label>
            <textarea
              id="remarks"
              className="innovic-textarea"
              rows={2}
              {...register('header.remarks')}
            />
          </div>
        </div>
      </Section>

      {/* Line items */}
      <Section
        standalone={standalone}
        title="Line Items"
        table
        actions={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={templateBusy}
              onClick={() => void downloadTemplate()}
            >
              {templateBusy ? 'Preparing…' : '⬇ Excel Template'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => lineFileRef.current?.click()}
            >
              📄 Import Excel
            </button>
            <input
              ref={lineFileRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportLines(f);
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                // A new line starts from the header Due Date helper, if set.
                const due = getValues('header.dueDate');
                append({ ...NEW_LINE, ...(due ? { dueDate: due } : {}) });
              }}
            >
              <Plus size={13} /> Add Line
            </button>
          </>
        }
      >
        {/* The template comes from the server now, so it can fail. Said right
            above the line table, where the button is. */}
        {templateError ? (
          <div style={{ margin: 'var(--sp-2)' }}>
            <Banner
              tone="error"
              role="alert"
              flush
              onDismiss={() => setTemplateError(null)}
              title={templateError}
            />
          </div>
        ) : null}

        {importMsg
          ? (() => {
              // Warn styling (amber) when the sheet carried codes missing from Item
              // Master — mirrors the SO form's "missing codes" banner.
              const isWarn = importMsg.includes('not found in Item Master');
              return (
                <div
                  className={isWarn ? undefined : 'text3'}
                  style={{
                    fontSize: 11,
                    margin: 'var(--sp-2)',
                    ...(isWarn
                      ? {
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: 'rgba(245,158,11,0.10)',
                          border: '1px solid rgba(245,158,11,0.35)',
                          color: 'var(--amber2)',
                        }
                      : {}),
                  }}
                >
                  {isWarn ? '⚠ ' : ''}
                  {importMsg}{' '}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setImportMsg(null)}
                  >
                    ✕
                  </button>
                </div>
              );
            })()
          : null}

        {/* The Assembly-BOM note, once above the table instead of under every
          line's select — the rule is the same on every row. The BOM itself now
          sits in each line's "▸ More" row. (0086: picking a BOM turns the line
          into an assembly — one Job Card per component on save, and
          readiness/return then follow the WEAKEST component rather than this
          line's own output. A BOM holding a bought part is refused
          server-side: job work runs on client-supplied material.) */}
        <div className="text3" style={{ fontSize: 11, margin: 'var(--sp-2)' }}>
          Assembly BOM (under ▸ More) — leave blank unless the customer ships parts for you to
          assemble.
        </div>

        {/* Same shape as the SO line editor: one row per line in a fixed-layout
          table. Visible: Ln, Item Code, Item Name, Customer RM, Drawing Rev,
          UOM, Order Qty, [Rate, Amount], Due Date; the less-used Material,
          Drawing No., Drawing File and Assembly BOM open per line under
          "▸ More", like ERPNext's grid row edit. Rate / Amount are dropped for a
          user who may not see prices. */}
        <table
          className="innovic-table tbl-ctr"
          style={{ width: '100%', tableLayout: 'fixed', minWidth: 1100 }}
        >
          <thead>
            <tr>
              <th style={{ width: '4%' }}>Ln</th>
              <th style={{ width: '14%' }}>
                Item Code <span className="req">★</span>
              </th>
              <th style={{ width: '16%' }}>Item Name</th>
              <th style={{ width: '12%' }} title="The customer's raw material for this item">
                Customer RM
              </th>
              <th style={{ width: '7%' }}>
                Drawing Rev <span className="req">★</span>
              </th>
              <th style={{ width: '7%' }}>UOM</th>
              <th className="th-num" style={{ width: '7%' }}>
                Order Qty <span className="req">★</span>
              </th>
              {priceVisible ? (
                <>
                  <th className="th-num" style={{ width: '8%', color: 'var(--green2)' }}>
                    Rate (₹)
                  </th>
                  <th className="th-num" style={{ width: '8%', color: 'var(--green2)' }}>
                    Amount
                  </th>
                </>
              ) : null}
              <th style={{ width: '10%' }}>Due Date</th>
              <th style={{ width: '8%' }} />
              <th style={{ width: '4%' }} />
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="empty-state" style={{ padding: 14 }}>
                  No lines yet — click <strong>+ Add Line</strong>. At least one is required.
                </td>
              </tr>
            ) : (
              fields.map((field, idx) => {
                const wl = watchedLines?.[idx];
                const amt = (Number(wl?.orderQty) || 0) * (Number(wl?.rate) || 0);
                // On-master item → name is derived + read-only; an older
                // off-master line (code with no master link) keeps it editable
                // until an item is picked.
                const lineOnMaster = Boolean(wl?.itemId);
                // ADR-203: used downstream → Item / UOM / BOM locked, no Remove.
                const inUse = Boolean(field.inUse);
                const isOpen = openMore.has(field.id);
                // How many of the folded fields hold a value — shown on the
                // toggle so a filled Material / BOM is never hidden silently.
                const filledMore = [
                  wl?.material,
                  wl?.drawingNo,
                  wl?.drawingFilePath,
                  wl?.sourceBomMasterId,
                ].filter((v) => typeof v === 'string' && v.trim() !== '').length;
                return (
                  <Fragment key={field.id}>
                    <tr>
                      <td className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                        {field.lineNo ?? '—'}
                      </td>
                      <td title={inUse ? IN_USE_TITLE : undefined}>
                        <SearchableSelect
                          id={`jwln-ic-${idx}`}
                          disabled={inUse}
                          value={wl?.itemId ?? null}
                          onChange={(id) => pickLineItem(idx, id)}
                          onSearch={setLineItemSearch}
                          loading={lineItemsFetching}
                          options={lineItems.map((it) => ({
                            id: it.id,
                            code: it.code,
                            name: it.name,
                          }))}
                          placeholder="🔍 Search item code or name..."
                          valueLabel={wl?.itemCodeText || undefined}
                          selectedLabel={(o) => o.code ?? o.name}
                        />
                      </td>
                      <td>
                        <input
                          className="innovic-input"
                          autoComplete="off"
                          readOnly={lineOnMaster}
                          title={lineOnMaster ? 'Auto-filled from Item Master' : undefined}
                          style={
                            lineOnMaster
                              ? { background: 'var(--bg4)', color: 'var(--text3)' }
                              : undefined
                          }
                          {...register(`lines.${idx}.partName` as const, {
                            required: 'Item Name is required.',
                          })}
                        />
                        {errors.lines?.[idx]?.partName?.message ? (
                          <div className="form-error">{errors.lines[idx]?.partName?.message}</div>
                        ) : null}
                      </td>
                      <td>
                        <CustomerRmCell rm={wl?.itemId ? rmByItem[wl.itemId] : undefined} />
                      </td>
                      {/* The client's drawing revision, typed exactly as it reads on
                        their print ('A', 'B', 'R1', '0'). Independent of the Drawing
                        File (under ▸ More) in BOTH directions. Compulsory — onValid
                        refuses the save when it is blank. */}
                      <td>
                        <input
                          className="innovic-input"
                          autoComplete="off"
                          placeholder="Drawing Rev"
                          maxLength={32}
                          style={{ textTransform: 'uppercase' }}
                          pattern={REV_INPUT_PATTERN}
                          title={REV_INPUT_TITLE}
                          {...upperCaseRevField(register(`lines.${idx}.revision` as const))}
                        />
                      </td>
                      <td title={inUse ? IN_USE_TITLE : undefined}>
                        {/* onValid sends the SAVED UOM for a line in use, so the
                          locked select can never change it. */}
                        <select
                          className="innovic-select"
                          disabled={inUse}
                          {...register(`lines.${idx}.uom` as const)}
                        >
                          {UOMS.map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td-num">
                        <input
                          type="number"
                          min={1}
                          placeholder="Qty"
                          className="innovic-input"
                          style={{ fontWeight: 700, color: 'var(--cyan)' }}
                          {...register(`lines.${idx}.orderQty` as const, {
                            valueAsNumber: true,
                            min: { value: 1, message: 'Min 1' },
                          })}
                        />
                      </td>
                      {priceVisible ? (
                        <>
                          <td className="td-num">
                            <input
                              type="number"
                              step="0.01"
                              min={0}
                              placeholder="₹ Rate"
                              className="innovic-input"
                              style={{ color: 'var(--green2)' }}
                              {...register(`lines.${idx}.rate` as const, { valueAsNumber: true })}
                            />
                          </td>
                          <td
                            className="mono td-num"
                            style={{ color: 'var(--green2)', fontWeight: 700 }}
                          >
                            {amt > 0 ? `₹${inrFormat(amt)}` : '—'}
                          </td>
                        </>
                      ) : null}
                      <td>
                        <input
                          type="date"
                          className="innovic-input"
                          aria-label={`Due Date, row ${idx + 1}`}
                          {...register(`lines.${idx}.dueDate` as const)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          aria-expanded={isOpen}
                          onClick={() => toggleMore(field.id)}
                          title="Material, Drawing No., Drawing File and Assembly BOM for this line"
                        >
                          {isOpen ? '▾ Less' : `▸ More${filledMore ? ` (${filledMore})` : ''}`}
                        </button>
                      </td>
                      <td>
                        {/* The wrapper carries the reason: a disabled button
                          shows no tooltip in every browser. */}
                        <span title={inUse ? IN_USE_TITLE : undefined}>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm btn-icon"
                            disabled={inUse}
                            onClick={() => remove(idx)}
                            aria-label={`Remove row ${idx + 1}`}
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td colSpan={colCount} style={{ background: 'var(--bg2)' }}>
                          <div className="form-grid-12" style={{ textAlign: 'left' }}>
                            <div className="form-grp f-md">
                              <label className="form-label">Material</label>
                              <input
                                className="innovic-input"
                                autoComplete="off"
                                {...register(`lines.${idx}.material` as const)}
                              />
                            </div>
                            <div className="form-grp f-md">
                              <label className="form-label">Drawing No.</label>
                              <input
                                className="innovic-input"
                                autoComplete="off"
                                {...register(`lines.${idx}.drawingNo` as const)}
                              />
                            </div>
                            <div className="form-grp f-md">
                              <label className="form-label">Drawing File</label>
                              <JwLineDrawingCell
                                value={watch(`lines.${idx}.drawingFilePath` as const)}
                                onChange={(p) =>
                                  setValue(`lines.${idx}.drawingFilePath` as const, p ?? null, {
                                    shouldDirty: true,
                                  })
                                }
                              />
                            </div>
                            <div className="form-grp f-lg" title={inUse ? IN_USE_TITLE : undefined}>
                              <label className="form-label">Assembly BOM</label>
                              <select
                                className="innovic-select"
                                disabled={inUse}
                                {...register(`lines.${idx}.sourceBomMasterId` as const)}
                              >
                                <option value="">— none (plain machining) —</option>
                                {jwUsableBoms.map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.bomNo} — {b.bomName}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* JWSO Totals (parity with the SO form) */}
      <div
        style={{
          marginTop: 12,
          border: '2px solid var(--green)',
          borderRadius: 8,
          padding: '10px 16px',
          background: 'rgba(34,197,94,0.03)',
        }}
      >
        {/* Money only for a user who may see prices; the count stays. */}
        {priceVisible ? (
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Tot label="Subtotal" value={subtotal} />
            <Tot label={`GST (${gstPercent}%)`} value={gstAmt} />
            <Tot label="Grand Total" value={grand} bold />
          </div>
        ) : null}
        <div className="text3" style={{ fontSize: 11, textAlign: 'right', marginTop: 4 }}>
          {lineCount} item{lineCount === 1 ? '' : 's'} • {totalPcs} total pcs
        </div>
      </div>

      {standalone ? null : (
        // Route still wraps the form in its own panel (no page header slot):
        // keep the Save row at the foot, blue primary.
        <div style={{ marginTop: 16 }}>
          {errorBanners}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            {cancelButton}
            {saveButton}
          </div>
        </div>
      )}

      {showAddClient ? (
        <QuickAddClient onClose={() => setShowAddClient(false)} onCreated={onClientCreated} />
      ) : null}
    </form>
  );
}

function Tot({
  label,
  value,
  bold,
}: {
  label: string;
  value: number;
  bold?: boolean;
}): React.JSX.Element {
  return (
    <div style={{ textAlign: 'right' }}>
      <div className="text3" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div
        className="mono"
        style={{
          fontSize: bold ? 18 : 14,
          fontWeight: 700,
          color: bold ? 'var(--green)' : 'var(--text)',
        }}
      >
        ₹{inrFormat(value)}
      </div>
    </div>
  );
}

function detailToFormValues(detail: JobWorkOrderDetail): FormValues {
  return {
    header: {
      code: detail.code,
      jwDate: detail.jwDate,
      status: detail.status,
      gstPercent: Number(detail.gstPercent),
      ...(detail.clientId ? { clientId: detail.clientId } : {}),
      ...(detail.customerName ? { customerName: detail.customerName } : {}),
      ...(detail.clientPoNo ? { clientPoNo: detail.clientPoNo } : {}),
      ...(detail.remarks ? { remarks: detail.remarks } : {}),
      // No header Due Date on load: it is only a helper that fills the lines,
      // and each line shows its own saved date below.
    },
    lines:
      detail.lines.length > 0
        ? detail.lines.map(
            (l): LineFormValue => ({
              id: l.id,
              lineNo: l.lineNo,
              ...(l.itemId ? { itemId: l.itemId } : {}),
              itemCodeText: l.itemCodeText ?? '',
              partName: l.partName,
              ...(l.material ? { material: l.material } : {}),
              ...(l.drawingNo ? { drawingNo: l.drawingNo } : {}),
              // '0' fallback for a JWSO saved before migration 0120 (and for the
              // window before the API starts sending the column). Non-blank, so
              // editing an old JWSO is never blocked by the compulsory-Rev rule.
              // Upper-cased on load (ADR-177) so a pre-capital-rule 'b' does not
              // fail the input's `pattern` and block the save.
              revision: normalizeRevision(l.revision ?? '0'),
              drawingFilePath: l.drawingFilePath ?? null,
              uom: l.uom,
              orderQty: l.orderQty,
              rate: Number(l.rate ?? 0),
              ...(l.dueDate ? { dueDate: l.dueDate } : {}),
              ...(l.sourceBomMasterId ? { sourceBomMasterId: l.sourceBomMasterId } : {}),
              inUse: l.inUse,
            }),
          )
        : [{ ...NEW_LINE }],
  };
}
