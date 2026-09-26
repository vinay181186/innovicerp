// /__ui-kit — the DEV-ONLY primitive gallery.
//
// Every component under apps/web/src/ui/ in every state it can be in, grouped
// by folder, each inside a <Panel> named after the component. Nothing here
// fetches: all data is the sample data defined at the bottom of this file, so
// the page renders with no session, no API and no network.
//
// It is registered in router.tsx behind `import.meta.env.DEV`, so it does not
// exist in a production build.
//
// Read it top to bottom to eyeball the new density: 13px body, 28px controls,
// 16px gutter. The token reference at the top reads the LIVE computed CSS
// variables off :root, so it can never drift from styles/tokens.css.

import { createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { rootRoute } from '@/routes/__root';
import {
  Badge,
  Button,
  Icon,
  IconButton,
  ICON_NAMES,
  PriorityText,
  StatusBadge,
  SyncDot,
  Tag,
  type BadgeTone,
  type Priority,
  type StatusKind,
  type SyncState,
  type TagTone,
} from '@/ui/core';
import {
  DataTable,
  EmptyState,
  Fact,
  ItemBadge,
  ItemImageBox,
  ItemThumbnailCell,
  ItemThumbnailHeader,
  KpiTiles,
  MachineCard,
  Panel,
  ProgressBar,
  QtyStrip,
  RelatedDocs,
  Skeleton,
  SortHeader,
  StatCard,
  StatStrip,
  Timeline,
  nextSort,
  type DataTableColumn,
  type SortState,
} from '@/ui/data';
import {
  Banner,
  ConfirmDialog,
  FilePreview,
  filePreviewKind,
  Modal,
  Toast,
  ToastProvider,
  useToast,
  type BannerTone,
  type ModalSize,
  type ToastKind,
} from '@/ui/feedback';
import {
  CheckField,
  DocNumberInputView,
  FileField,
  FormField,
  FormGrid,
  Input,
  LineItemPicker,
  SearchableSelect,
  SearchInput,
  Select,
  Textarea,
  type DocNumberInputState,
  type FormFieldSize,
  type LineItemPickerValue,
} from '@/ui/forms';
import {
  AttentionList,
  DetailHeader,
  DocCard,
  LinesPanel,
  LinkSlot,
  ListFooter,
  ListHeader,
  PageHeader,
  PageState,
  QuickLinks,
  ReadField,
  ReadGrid,
  RowActions,
  StatRow,
  StatusPills,
  ViewToggle,
  WorkList,
  type PageStateKind,
} from '@/ui/layout';
import { Breadcrumbs, FilterBar, PageTabs, TabStrip } from '@/ui/navigation';

// ───────────────────────────────────────────────────────────────────────────
// Route
// ───────────────────────────────────────────────────────────────────────────

// `/* @__PURE__ */` matters: router.tsx only spreads this route in when
// `import.meta.env.DEV`, which is a literal `false` in a production build. The
// annotation tells the bundler this top-level call has no side effects, so once
// that branch is dropped the whole kit — page, sample data and all — is tree-
// shaken out of the production bundle instead of merely being unreachable.
export const uiKitRoute = /* @__PURE__ */ createRoute({
  getParentRoute: () => rootRoute,
  path: '/__ui-kit',
  component: UiKitPage,
});

// ───────────────────────────────────────────────────────────────────────────
// Small local helpers — layout only, no new design vocabulary.
// ───────────────────────────────────────────────────────────────────────────

/** A labelled cluster of states inside a Panel. */
function State({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div className="form-label" style={{ marginBottom: 'var(--sp-1)' }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/** Horizontal wrap of samples, aligned on one baseline. */
function Row({ children, gap = 'var(--sp-2)' }: { children: React.ReactNode; gap?: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap }}>{children}</div>
  );
}

/** A folder heading between panel groups. */
function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: 'var(--hfont)',
        fontSize: 'var(--fs-lg)',
        color: 'var(--text)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        margin: 'var(--sp-5) 0 var(--sp-2)',
        borderBottom: '1px solid var(--border2)',
        paddingBottom: 'var(--sp-1)',
      }}
    >
      {children}
    </h2>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Token reference — reads the live computed values off :root.
// ───────────────────────────────────────────────────────────────────────────

const SURFACE_TOKENS = ['--bg', '--bg2', '--bg3', '--bg4', '--bg5', '--sheet-cream'] as const;
const TEXT_TOKENS = ['--text', '--text2', '--text3', '--border', '--border2', '--border3'] as const;
const ACCENT_TOKENS = [
  '--blue',
  '--blue2',
  '--blue3',
  '--green',
  '--green2',
  '--green3',
  '--amber',
  '--amber2',
  '--amber3',
  '--red',
  '--red2',
  '--red3',
  '--orange',
  '--orange2',
  '--orange3',
  '--purple',
  '--purple2',
  '--purple3',
  '--teal',
  '--teal2',
  '--teal3',
  '--cyan',
  '--cyan2',
  '--cyan3',
] as const;
const SIGNAL_TOKENS = [
  '--sig-critical',
  '--sig-critical-bg',
  '--sig-warn',
  '--sig-warn-bg',
  '--sig-ok',
  '--sig-ok-bg',
  '--sig-info',
  '--sig-info-bg',
  '--sig-neutral',
  '--sig-neutral-bg',
] as const;
const DEPT_TOKENS = [
  '--dept-planning',
  '--dept-sales',
  '--dept-store',
  '--dept-design',
  '--dept-production',
  '--dept-qc',
  '--dept-purchase',
  '--dept-finance',
  '--dept-tasks',
  '--dept-system',
] as const;

const TYPE_STEPS = [
  { token: '--fs-xs', use: 'labels · table headers · badges · help · meta' },
  { token: '--fs-sm', use: 'body · controls · table cells · buttons · menus' },
  { token: '--fs-md', use: 'panel / modal / card titles' },
  { token: '--fs-lg', use: 'page title (.section-hdr)' },
  { token: '--fs-xl', use: 'KPI / stat values · empty-state glyph' },
] as const;

const RADIUS_TOKENS = [
  { token: '--radius-sm', use: 'badges · tags · chips' },
  { token: '--radius', use: 'buttons · inputs · tabs' },
  { token: '--radius2', use: 'panels · cards · modals' },
  { token: '--radius-menu', use: 'dropdown menus' },
] as const;

const SPACING_TOKENS = [
  '--sp-0',
  '--sp-1',
  '--sp-2',
  '--sp-3',
  '--sp-4',
  '--sp-5',
  '--sp-6',
] as const;

const SIZING_TOKENS = [
  { token: '--control-h', use: 'buttons · inputs · selects' },
  { token: '--control-h-sm', use: 'small buttons · row actions' },
  { token: '--topbar-height', use: 'the one header band' },
  { token: '--content-pad', use: 'page gutter' },
  { token: '--panel-gap', use: 'gap between panels' },
  { token: '--field-xs', use: '%, rev, ln, days, UOM' },
  { token: '--field-sm', use: 'qty, rate, amount' },
  { token: '--field-md', use: 'date, code, filter select' },
  { token: '--field-lg', use: 'names, search' },
] as const;

const ALL_TOKEN_NAMES: readonly string[] = [
  ...SURFACE_TOKENS,
  ...TEXT_TOKENS,
  ...ACCENT_TOKENS,
  ...SIGNAL_TOKENS,
  ...DEPT_TOKENS,
  ...TYPE_STEPS.map((t) => t.token),
  ...RADIUS_TOKENS.map((t) => t.token),
  ...SPACING_TOKENS,
  ...SIZING_TOKENS.map((t) => t.token),
];

/** Resolve every token once, off the live :root — the board never hard-codes a value. */
function useTokenValues(): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const name of ALL_TOKEN_NAMES) next[name] = cs.getPropertyValue(name).trim();
    setValues(next);
  }, []);
  return values;
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        padding: 'var(--sp-1) var(--sp-2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--bg2)',
        minWidth: 200,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border2)',
          background: `var(${name})`,
          flexShrink: 0,
        }}
      />
      <span style={{ display: 'grid', lineHeight: 1.3 }}>
        <b style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--text)' }}>
          {name}
        </b>
        <span
          style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}
        >
          {value || '—'}
        </span>
      </span>
    </div>
  );
}

function SwatchRow({
  names,
  values,
}: {
  names: readonly string[];
  values: Record<string, string>;
}) {
  return (
    <Row>
      {names.map((n) => (
        <Swatch key={n} name={n} value={values[n] ?? ''} />
      ))}
    </Row>
  );
}

function TokenReference() {
  const values = useTokenValues();
  return (
    <>
      <Panel title="Colour tokens — surfaces">
        <SwatchRow names={SURFACE_TOKENS} values={values} />
      </Panel>
      <Panel title="Colour tokens — text & borders">
        <SwatchRow names={TEXT_TOKENS} values={values} />
      </Panel>
      <Panel title="Colour tokens — accents (solid / dark / wash)">
        <SwatchRow names={ACCENT_TOKENS} values={values} />
      </Panel>
      <Panel title="Colour tokens — signals">
        <SwatchRow names={SIGNAL_TOKENS} values={values} />
      </Panel>
      <Panel title="Colour tokens — department identity">
        <SwatchRow names={DEPT_TOKENS} values={values} />
      </Panel>

      <Panel title="Type scale — five steps, nothing else">
        {TYPE_STEPS.map((step) => (
          <div
            key={step.token}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--sp-3)',
              padding: 'var(--sp-1) 0',
              borderBottom: '1px dashed var(--border)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text3)',
                width: 150,
                flexShrink: 0,
              }}
            >
              {step.token} · {values[step.token] ?? ''}
            </span>
            <span style={{ fontSize: `var(${step.token})`, color: 'var(--text)' }}>
              IN-SO-00042 · Shaft Housing
            </span>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>{step.use}</span>
          </div>
        ))}
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <Row>
            <span style={{ fontFamily: 'var(--hfont)', fontSize: 'var(--fs-md)' }}>
              --hfont Barlow Condensed
            </span>
            <span style={{ fontFamily: 'var(--bfont)', fontSize: 'var(--fs-sm)' }}>
              --bfont Barlow
            </span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-sm)' }}>
              --mono Source Code Pro
            </span>
          </Row>
        </div>
      </Panel>

      <Panel title="Radii">
        <Row gap="var(--sp-3)">
          {RADIUS_TOKENS.map((r) => (
            <div key={r.token} style={{ display: 'grid', gap: 'var(--sp-1)', width: 170 }}>
              <span
                style={{
                  height: 44,
                  background: 'var(--bg4)',
                  border: '1px solid var(--border2)',
                  borderRadius: `var(${r.token})`,
                }}
              />
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text)',
                }}
              >
                {r.token} · {values[r.token] ?? ''}
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>{r.use}</span>
            </div>
          ))}
        </Row>
      </Panel>

      <Panel title="Spacing scale — 4px base">
        <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
          {SPACING_TOKENS.map((t) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text3)',
                  width: 110,
                }}
              >
                {t} · {values[t] ?? ''}
              </span>
              <span
                style={{ height: 12, width: `var(${t})`, background: 'var(--blue)', minWidth: 2 }}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Control heights & field widths">
        <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
          {SIZING_TOKENS.map((s) => (
            <div
              key={s.token}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
            >
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text)',
                  width: 170,
                }}
              >
                {s.token} · {values[s.token] ?? ''}
              </span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>{s.use}</span>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// core
// ───────────────────────────────────────────────────────────────────────────

const BADGE_TONES: readonly BadgeTone[] = [
  'green',
  'amber',
  'blue',
  'red',
  'grey',
  'cyan',
  'orange',
  'teal',
  'purple',
];

const TAG_TONES: readonly TagTone[] = ['link', 'neutral', 'rev'];
const SYNC_STATES: readonly SyncState[] = ['ok', 'offline', 'error'];
const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'normal', 'low'];

/** Every StatusBadge kind with a couple of real statuses each. */
const STATUS_SAMPLES: ReadonlyArray<{ kind: StatusKind; statuses: readonly string[] }> = [
  { kind: 'so', statuses: ['draft', 'open', 'closed', 'dispatched', 'cancelled'] },
  { kind: 'jc', statuses: ['open', 'qc_pending', 'complete', 'closed', 'no_ops'] },
  { kind: 'jcop', statuses: ['waiting', 'available', 'in_progress', 'at_vendor', 'complete'] },
  { kind: 'pr', statuses: ['open', 'approved', 'po_created', 'cancelled'] },
  { kind: 'po', statuses: ['draft', 'open', 'partial', 'closed'] },
  { kind: 'prodorder', statuses: ['open', 'partially_closed', 'closed'] },
  { kind: 'grnqc', statuses: ['pending', 'in_progress', 'completed'] },
  { kind: 'dc', statuses: ['issued', 'received', 'cancelled'] },
  { kind: 'nc', statuses: ['pending', 'under_rework', 'rework_done', 'closed'] },
  { kind: 'ncdisp', statuses: ['rework', 'scrap', 'use_as_is', 'return_to_vendor'] },
  { kind: 'txn', statuses: ['in', 'out', 'adjust'] },
  { kind: 'active', statuses: ['active', 'inactive'] },
  { kind: 'rating', statuses: ['a', 'b', 'c', 'd'] },
  { kind: 'task', statuses: ['todo', 'in_progress', 'completed', 'cancelled'] },
  { kind: 'grn', statuses: ['pending', 'close', 'against_dc', 'against_nc'] },
  { kind: 'run', statuses: ['running', 'done', 'stopped'] },
  { kind: 'doc', statuses: ['open', 'in_progress', 'approved', 'overdue'] },
];

function CoreSection() {
  return (
    <>
      <GroupHeading>core</GroupHeading>

      <Panel title="Button">
        <State label="Variants — md (13px / 28px)">
          <Row>
            <Button variant="primary">Save Sales Order</Button>
            <Button variant="success">Approve</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="ghost">Cancel</Button>
          </Row>
        </State>
        <State label="Variants — sm (11px / 24px)">
          <Row>
            <Button variant="primary" size="sm">
              Save
            </Button>
            <Button variant="success" size="sm">
              Approve
            </Button>
            <Button variant="danger" size="sm">
              Delete
            </Button>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </Row>
        </State>
        <State label="With a leading icon (hover them — the hover styles are live CSS)">
          <Row>
            <Button variant="primary" icon={<Icon name="plus" />}>
              New Job Card
            </Button>
            <Button variant="ghost" icon={<Icon name="download" />}>
              Export
            </Button>
            <Button variant="ghost" icon={<Icon name="printer" />}>
              Print
            </Button>
            <Button variant="ghost" size="sm" icon={<Icon name="refresh-cw" />}>
              Refresh
            </Button>
          </Row>
        </State>
        <State label="Loading — spinner in the icon slot, click blocked">
          <Row>
            <Button variant="primary" loading>
              Saving…
            </Button>
            <Button variant="success" loading size="sm">
              Approving…
            </Button>
          </Row>
        </State>
        <State label="Disabled">
          <Row>
            <Button variant="primary" disabled>
              Save
            </Button>
            <Button variant="success" disabled>
              Approve
            </Button>
            <Button variant="danger" disabled>
              Delete
            </Button>
            <Button variant="ghost" disabled>
              Cancel
            </Button>
          </Row>
        </State>
        <State label="Pill — status-filter chips only (the one place a 999px radius is allowed)">
          <Row>
            <Button variant="primary" size="sm" pill>
              All
            </Button>
            <Button variant="ghost" size="sm" pill>
              Open
            </Button>
            <Button variant="ghost" size="sm" pill>
              Closed
            </Button>
          </Row>
        </State>
      </Panel>

      <Panel title="IconButton">
        <State label="Default (ghost) — title is required and doubles as the accessible name">
          <Row>
            <IconButton icon={<Icon name="eye" />} title="View" />
            <IconButton icon={<Icon name="pencil" />} title="Edit" />
            <IconButton icon={<Icon name="trash-2" />} title="Delete" variant="danger" />
            <IconButton icon={<Icon name="printer" />} title="Print" />
            <IconButton icon={<Icon name="download" />} title="Export" />
          </Row>
        </State>
        <State label="Small + disabled + loading">
          <Row>
            <IconButton icon={<Icon name="eye" size={12} />} title="View" size="sm" />
            <IconButton icon={<Icon name="pencil" size={12} />} title="Edit" size="sm" disabled />
            <IconButton icon={<Icon name="refresh-cw" />} title="Refresh" loading />
          </Row>
        </State>
      </Panel>

      <Panel title="Icon — the whole set">
        <Row gap="var(--sp-3)">
          {ICON_NAMES.map((name) => (
            <span
              key={name}
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'var(--sp-1)',
                width: 92,
              }}
            >
              <Icon name={name} size={15} color="var(--text2)" />
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text3)',
                }}
              >
                {name}
              </span>
            </span>
          ))}
        </Row>
      </Panel>

      <Panel title="Badge — every tone">
        <Row>
          {BADGE_TONES.map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
        </Row>
      </Panel>

      <Panel title="StatusBadge — every kind">
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {STATUS_SAMPLES.map((s) => (
            <div key={s.kind} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <span
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text3)',
                  width: 80,
                  flexShrink: 0,
                }}
              >
                {s.kind}
              </span>
              <Row>
                {s.statuses.map((st) => (
                  <StatusBadge key={st} kind={s.kind} status={st} />
                ))}
              </Row>
            </div>
          ))}
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text2)' }}>
            Unknown value falls back to grey: <StatusBadge kind="so" status="something_else" /> ·
            with an explicit label override:{' '}
            <StatusBadge kind="jc" status="qc_pending" label="Waiting on QC" />
          </div>
        </div>
      </Panel>

      <Panel title="Tag">
        <State label="Tones">
          <Row>
            {TAG_TONES.map((tone) => (
              <Tag key={tone} tone={tone}>
                {tone === 'rev' ? 'REV B' : tone === 'link' ? 'IN-SO-00042' : 'Neutral'}
              </Tag>
            ))}
          </Row>
        </State>
        <State label="Clickable (focusable, answers Enter / Space) + token colour override">
          <Row>
            <Tag tone="link" onClick={() => undefined} title="Opens the linked Sales Order">
              IN-SO-00042
            </Tag>
            <Tag color="var(--purple2)" bg="var(--purple3)">
              CPO
            </Tag>
          </Row>
        </State>
      </Panel>

      <Panel title="SyncDot">
        <Row gap="var(--sp-4)">
          {SYNC_STATES.map((state) => (
            <SyncDot key={state} state={state} label={<span className="mono">{state}</span>} />
          ))}
          <SyncDot state="ok" />
        </Row>
      </Panel>

      <Panel title="PriorityText">
        <Row gap="var(--sp-4)">
          {PRIORITIES.map((p) => (
            <PriorityText key={p} priority={p} />
          ))}
        </Row>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// forms
// ───────────────────────────────────────────────────────────────────────────

const FIELD_SIZES: readonly FormFieldSize[] = ['xs', 'sm', 'md', 'lg', 'full'];
const DOC_STATES: readonly DocNumberInputState[] = ['idle', 'checking', 'ok', 'bad'];

const SELECT_OPTIONS = [
  { value: 'nos', label: 'Nos' },
  { value: 'kg', label: 'Kg' },
  { value: 'mtr', label: 'Metre' },
  { value: 'set', label: 'Set (not stocked)', disabled: true },
];

const SEARCHABLE_OPTIONS = [
  { id: 'c1', code: 'IN-CL-0007', name: 'Bharat Heavy Electricals' },
  { id: 'c2', code: 'IN-CL-0012', name: 'Larsen Engineering Works' },
  { id: 'c3', code: 'IN-CL-0031', name: 'Suzlon Energy Ltd' },
];

const PICKER_ITEMS = [
  { id: 'i1', code: 'IN-IT-0101', name: 'Shaft Housing', material: 'EN8' },
  { id: 'i2', code: 'IN-IT-0102', name: 'End Cover', material: 'MS' },
  { id: 'i3', code: 'IN-IT-0103', name: 'Bearing Sleeve', material: 'SS304' },
];

function FormsSection() {
  const [text, setText] = useState('IN-SO-00042');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState<string | null>('c2');
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState('in-house');
  const [docNo, setDocNo] = useState('00042');
  const [line, setLine] = useState<LineItemPickerValue>({
    code: 'IN-IT-0101',
    itemId: 'i1',
    name: 'Shaft Housing',
    matched: true,
  });

  return (
    <>
      <GroupHeading>forms</GroupHeading>

      <Panel title="FormGrid + FormField — the 12-column grid">
        <State label="Every field width on the grid">
          <FormGrid>
            {FIELD_SIZES.map((size) => (
              <FormField key={size} label={`size="${size}"`} size={size}>
                <Input defaultValue={size.toUpperCase()} />
              </FormField>
            ))}
          </FormGrid>
        </State>
        <State label="Required · help · error · read-only · derived">
          <FormGrid>
            <FormField label="SO No." required size="sm" help="Auto-numbered on save.">
              <Input defaultValue="IN-SO-00042" mono />
            </FormField>
            <FormField label="Client" required size="lg" error="Client is required">
              <Input state="bad" placeholder="Pick a client…" />
            </FormField>
            <FormField label="Qty" size="xs" help="Nos">
              <Input defaultValue="120" state="ok" mono />
            </FormField>
            <FormField label="Item Name" size="lg" help="Filled in from the Item Master.">
              <Input defaultValue="Shaft Housing" state="derived" readOnly />
            </FormField>
            <FormField label="Created By" size="md" help="Read-only.">
              <Input defaultValue="vinay" readOnly />
            </FormField>
            <FormField label="Closed On" size="md" help="Not available yet.">
              <Input disabled placeholder="—" />
            </FormField>
          </FormGrid>
        </State>
        <State label="Legacy equal-column grids (deprecated — cols 2 / 3 / 4)">
          <FormGrid cols={3}>
            <FormField label="A" size="full">
              <Input />
            </FormField>
            <FormField label="B" size="full">
              <Input />
            </FormField>
            <FormField label="C" size="full">
              <Input />
            </FormField>
          </FormGrid>
        </State>
      </Panel>

      <Panel title="Input">
        <State label="States — default · ok · bad · derived · disabled · read-only · mono">
          <Row>
            <Input placeholder="Default" fieldWidth="md" />
            <Input defaultValue="Valid" state="ok" fieldWidth="md" />
            <Input defaultValue="Duplicate" state="bad" fieldWidth="md" />
            <Input defaultValue="From the master" state="derived" readOnly fieldWidth="md" />
            <Input defaultValue="Disabled" disabled fieldWidth="md" />
            <Input defaultValue="IN-JC-00817" mono fieldWidth="md" />
          </Row>
        </State>
        <State label="Off-grid widths — xs (64) · sm (104) · md (144) · lg (224)">
          <Row>
            <Input fieldWidth="xs" placeholder="%" />
            <Input fieldWidth="sm" placeholder="Qty" />
            <Input fieldWidth="md" placeholder="Date" type="date" />
            <Input fieldWidth="lg" placeholder="Name" />
          </Row>
        </State>
        <State label="Controlled">
          <Input value={text} onChange={(e) => setText(e.target.value)} fieldWidth="lg" mono />
        </State>
      </Panel>

      <Panel title="Textarea">
        <Row gap="var(--sp-3)">
          <Textarea placeholder="Remarks…" style={{ width: 'var(--field-lg)' }} />
          <Textarea rows={4} defaultValue={'Line 1\nLine 2'} style={{ width: 'var(--field-lg)' }} />
          <Textarea disabled defaultValue="Disabled" style={{ width: 'var(--field-lg)' }} />
        </Row>
      </Panel>

      <Panel title="Select">
        <Row>
          <Select options={SELECT_OPTIONS} placeholder="Select UOM…" fieldWidth="md" />
          <Select options={['Open', 'Closed', 'Cancelled']} defaultValue="Open" fieldWidth="md" />
          <Select options={SELECT_OPTIONS} disabled placeholder="Disabled" fieldWidth="md" />
        </Row>
      </Panel>

      <Panel title="SearchInput">
        <State label="Widths — md / lg / full / explicit px">
          <Row>
            <SearchInput width="md" placeholder="md" />
            <SearchInput width="lg" placeholder="Search this list…" />
            <SearchInput width={320} placeholder="320px" />
          </Row>
          <Row>
            <SearchInput width="full" placeholder="full" />
          </Row>
        </State>
        <State label="Controlled (debounced 250ms) + disabled">
          <Row>
            <SearchInput
              value={search}
              onChange={setSearch}
              debounceMs={250}
              placeholder="Search anything…"
            />
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
              term: <span className="mono">{search || '—'}</span>
            </span>
            <SearchInput disabled placeholder="Disabled" />
          </Row>
        </State>
      </Panel>

      <Panel title="CheckField">
        <State label="Checkbox — unchecked · checked · disabled">
          <Row gap="var(--sp-4)">
            <CheckField label="Include closed" checked={checked} onChange={setChecked} />
            <CheckField label="Uncontrolled default" defaultChecked />
            <CheckField label="Disabled" disabled />
            <CheckField label="Disabled + checked" disabled defaultChecked />
          </Row>
        </State>
        <State label="Radio group">
          <Row gap="var(--sp-4)">
            <CheckField
              type="radio"
              name="kit-route"
              label="In-house"
              checked={radio === 'in-house'}
              onChange={() => setRadio('in-house')}
            />
            <CheckField
              type="radio"
              name="kit-route"
              label="Outsource (OSP)"
              checked={radio === 'osp'}
              onChange={() => setRadio('osp')}
            />
          </Row>
        </State>
      </Panel>

      <Panel title="SearchableSelect — the type-to-search picker">
        <State label="Empty · selected · loading · disabled · no results">
          <FormGrid>
            <FormField label="Client" required size="lg">
              <SearchableSelect
                value={null}
                onChange={() => undefined}
                options={SEARCHABLE_OPTIONS}
                placeholder="Type to search…"
              />
            </FormField>
            <FormField label="Client (selected)" size="lg">
              <SearchableSelect value={client} onChange={setClient} options={SEARCHABLE_OPTIONS} />
            </FormField>
            <FormField label="Loading" size="lg">
              <SearchableSelect
                value={null}
                onChange={() => undefined}
                options={[]}
                loading
                placeholder="Type to search…"
              />
            </FormField>
            <FormField label="Disabled" size="lg">
              <SearchableSelect
                value={null}
                onChange={() => undefined}
                options={SEARCHABLE_OPTIONS}
                disabled
                placeholder="Pick a Sales Order first"
              />
            </FormField>
            <FormField label="No results" size="lg">
              <SearchableSelect
                value={null}
                onChange={() => undefined}
                options={[]}
                emptyText="No vendor matches that."
                placeholder="Type to search…"
              />
            </FormField>
          </FormGrid>
        </State>
      </Panel>

      <Panel title="DocNumberInput (view half — the live one checks the server)">
        <FormGrid>
          {DOC_STATES.map((state) => (
            <DocNumberInputView
              key={state}
              label={`state="${state}"`}
              required
              value={docNo}
              onChange={setDocNo}
              state={state}
              id={`kit-doc-${state}`}
            />
          ))}
          <DocNumberInputView
            label="read-only (edit mode)"
            value="IN-SO-00042"
            readOnly
            id="kit-doc-ro"
          />
          <DocNumberInputView
            label="bad + message"
            required
            value="00042"
            state="bad"
            message="IN-SO-00042 already exists"
            id="kit-doc-bad"
          />
        </FormGrid>
      </Panel>

      <Panel title="LineItemPicker — code is the key, name derives from it">
        <State label="Editable — type IN-IT-0102 to watch the name derive and lock">
          <FormGrid>
            <LineItemPicker
              code={line.code}
              name={line.name}
              items={PICKER_ITEMS}
              onChange={setLine}
            />
          </FormGrid>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
            matched: <span className="mono">{String(line.matched)}</span> · itemId:{' '}
            <span className="mono">{line.itemId ?? 'null'}</span>
          </div>
        </State>
        <State label="Read-only (a QC-locked GRN line) + a name error">
          <FormGrid>
            <LineItemPicker
              code="IN-IT-0103"
              name="Bearing Sleeve"
              items={PICKER_ITEMS}
              readOnly
              onChange={() => undefined}
            />
          </FormGrid>
          <FormGrid>
            <LineItemPicker
              code="OFF-MASTER-1"
              name=""
              items={PICKER_ITEMS}
              nameError="Item name is required"
              onChange={() => undefined}
            />
          </FormGrid>
        </State>
      </Panel>

      <Panel title="FileField">
        <State label='variant="attach" — empty · attached · uploading · error · disabled'>
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <FileField onPick={() => undefined} />
            <FileField fileName="qc-report-0042.pdf" onRemove={() => undefined} />
            <FileField busy />
            <FileField error="File is larger than 10 MB" />
            <FileField disabled />
          </div>
        </State>
        <State label='variant="drawing" — empty · attached · error'>
          <FormGrid>
            <FileField variant="drawing" size="md" onPick={() => undefined} />
            <FileField
              variant="drawing"
              size="md"
              fileName="SH-101-RevB.pdf"
              onView={() => undefined}
              onRemove={() => undefined}
            />
            <FileField variant="drawing" size="md" error="Upload failed — try again" />
          </FormGrid>
        </State>
        <State label='variant="image" — empty · with a preview box · busy'>
          <FormGrid>
            <FileField variant="image" size="md" onPick={() => undefined} />
            <FileField
              variant="image"
              size="md"
              fileName="shaft-housing.jpg"
              preview={<ItemImageBox size="card" alt="Shaft Housing" />}
              onRemove={() => undefined}
            />
            <FileField variant="image" size="md" busy />
          </FormGrid>
        </State>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// data
// ───────────────────────────────────────────────────────────────────────────

interface DemoRow {
  id: string;
  doc: string;
  item: string;
  qty: number;
  done: number;
  status: string;
  date: string;
}

const DEMO_ROWS: DemoRow[] = [
  {
    id: 'r1',
    doc: 'IN-JC-00817',
    item: 'Shaft Housing',
    qty: 120,
    done: 120,
    status: 'closed',
    date: '2026-09-02',
  },
  {
    id: 'r2',
    doc: 'IN-JC-00818',
    item: 'End Cover',
    qty: 60,
    done: 24,
    status: 'open',
    date: '2026-09-09',
  },
  {
    id: 'r3',
    doc: 'IN-JC-00819',
    item: 'Bearing Sleeve — long name that has to clip somewhere on a narrow column',
    qty: 300,
    done: 0,
    status: 'qc_pending',
    date: '2026-09-18',
  },
];

const TIMELINE_EVENTS = [
  { key: 't1', date: '2026-09-01', label: 'Sales Order raised', code: 'IN-SO-00042' },
  {
    key: 't2',
    date: '2026-09-03',
    label: 'Job Card issued',
    detail: '3 operations planned',
    code: 'IN-JC-00817',
    color: 'var(--blue)',
  },
  {
    key: 't3',
    date: '2026-09-12',
    label: 'Sent to vendor (OSP)',
    detail: 'Heat treatment — Suryo Metallurgicals',
    code: 'IN-DC-00211',
    color: 'var(--amber2)',
  },
  {
    key: 't4',
    date: '2026-09-20',
    label: 'Dispatched',
    detail: '120 Nos',
    code: 'IN-INV-00088',
    color: 'var(--green2)',
  },
];

const RELATED_SECTIONS = [
  {
    key: 'jc',
    title: 'Job Cards',
    icon: '▭',
    items: [
      { id: 'j1', code: 'IN-JC-00817', label: 'Shaft Housing', date: '2026-09-03' },
      { id: 'j2', code: 'IN-JC-00818', label: 'End Cover', date: '2026-09-09' },
    ],
  },
  {
    key: 'po',
    title: 'Purchase Orders',
    icon: '🧾',
    items: [{ id: 'p1', code: 'IN-PO-00311', label: 'EN8 round bar', date: '2026-09-05' }],
  },
  { key: 'nc', title: 'NC Register', icon: '⚠', items: [] },
];

function DataSection() {
  const [sort, setSort] = useState<SortState>({ sortBy: 'doc', sortDir: 'asc' });
  const [activeStat, setActiveStat] = useState('open');
  const [openImage, setOpenImage] = useState(false);

  const columns = useMemo<DataTableColumn<DemoRow>[]>(
    () => [
      {
        header: 'Job Card',
        key: 'doc',
        width: '18%',
        className: 'mono fw-700',
        nowrap: true,
        sortField: 'doc',
      },
      { header: 'Item', key: 'item', width: '34%', align: 'left', ellipsis: true },
      { header: 'Qty', key: 'qty', width: '10%', nowrap: true, sortField: 'qty' },
      {
        header: 'Done',
        key: 'done',
        width: '10%',
        nowrap: true,
        headColor: 'var(--green)',
      },
      {
        header: 'Balance',
        width: '10%',
        nowrap: true,
        headColor: 'var(--red)',
        render: (row) => row.qty - row.done,
      },
      {
        header: 'Status',
        width: '10%',
        render: (row) => <StatusBadge kind="jc" status={row.status} />,
      },
      { header: 'Date', key: 'date', width: '8%', nowrap: true, sortField: 'date' },
    ],
    [],
  );

  return (
    <>
      <GroupHeading>data</GroupHeading>

      <Panel title="Panel — header, actions, accent, flush body">
        <State label="Plain body (default 12px padding)">
          <Panel title="Panel with a title">Body content sits on --sp-3 of padding.</Panel>
        </State>
        <State label="With actions and a left accent bar">
          <Panel
            title="Open Sales Orders"
            accent="var(--blue)"
            actions={
              <>
                <Badge tone="blue">12</Badge>
                <Button size="sm" variant="ghost" icon={<Icon name="download" size={12} />}>
                  Export
                </Button>
              </>
            }
          >
            An accent bar is a token only — blue open · red late · green done.
          </Panel>
        </State>
        <State label='bodyPadding="none" — a table fills the panel edge to edge'>
          <Panel title="Lines" bodyPadding="none">
            <DataTable columns={columns.slice(0, 3)} rows={DEMO_ROWS} />
          </Panel>
        </State>
        <State label="No title (a bare surface)">
          <Panel>Just a surface.</Panel>
        </State>
      </Panel>

      <Panel title="StatStrip / StatCard / KpiTiles">
        <State label="StatStrip — clickable filter cells, one active">
          <StatStrip
            items={[
              {
                key: 'all',
                label: 'All',
                count: 42,
                active: activeStat === 'all',
                onClick: () => setActiveStat('all'),
              },
              {
                key: 'open',
                label: 'Open',
                count: 18,
                color: 'var(--amber2)',
                sub: <span style={{ color: 'var(--red2)' }}>3 overdue</span>,
                active: activeStat === 'open',
                onClick: () => setActiveStat('open'),
              },
              {
                key: 'closed',
                label: 'Closed',
                count: 21,
                color: 'var(--green2)',
                active: activeStat === 'closed',
                onClick: () => setActiveStat('closed'),
              },
              { key: 'value', label: 'Order Value', count: '1,240.50' },
            ]}
          />
        </State>
        <State label="StatStrip — read-only (no onClick, so no control is announced)">
          <StatStrip
            items={[
              { key: 'a', label: 'Received', count: 120, color: 'var(--green2)' },
              { key: 'b', label: 'Balance', count: 30, color: 'var(--red2)' },
              { key: 'c', label: 'Rejected', count: 0 },
            ]}
          />
        </State>
        <State label="StatCard — accents">
          <Row>
            <StatCard label="Open" value={18} accent="amber" sub="3 overdue" />
            <StatCard label="Closed" value={21} accent="green" />
            <StatCard label="Late" value={3} accent="red" />
            <StatCard label="Total" value="1,240.50" accent="cyan" />
          </Row>
        </State>
        <State label="KpiTiles">
          <KpiTiles
            items={[
              { key: 'todo', label: 'To Do', value: 7, color: 'var(--amber2)' },
              { key: 'wip', label: 'In Progress', value: 3, color: 'var(--blue)', active: true },
              { key: 'done', label: 'Completed', value: 21, color: 'var(--green2)' },
              { key: 'late', label: 'Overdue', value: 2, color: 'var(--red2)' },
            ]}
            onSelect={() => undefined}
          />
        </State>
      </Panel>

      <Panel title="ProgressBar">
        <div style={{ display: 'grid', gap: 'var(--sp-2)', maxWidth: 420 }}>
          <ProgressBar value={0} label="0% — not started" />
          <ProgressBar value={35} label="35%" color="var(--amber)" />
          <ProgressBar value={100} label="100% — done" color="var(--green)" />
          <ProgressBar value={72} height={10} color="var(--blue)" />
          <ProgressBar value={140} label="clamped at 100" color="var(--red)" />
        </div>
      </Panel>

      <Panel title="QtyStrip / Fact">
        <State label="QtyStrip — the qty colour rules come from the caller">
          <QtyStrip
            items={[
              { label: 'Ordered', value: 120 },
              { label: 'Dispatched', value: 90, color: 'var(--green2)' },
              { label: 'Balance', value: 30, color: 'var(--red2)' },
              { label: 'Rejected', value: 0, color: 'var(--text3)' },
            ]}
          />
        </State>
        <State label="Fact — normal · big · empty">
          <Row gap="var(--sp-5)">
            <Fact label="Client" value="Larsen Engineering Works" />
            <Fact label="Order Value" value="₹ 12,40,500" big color="var(--green2)" />
            <Fact label="Closed On" value={null} />
          </Row>
        </State>
      </Panel>

      <Panel title="ItemBadge / ItemImageBox / ItemThumbnailCell">
        <State label="Sizes — row 40 · card 56 · page 96 · tile 120">
          <Row gap="var(--sp-5)">
            <ItemBadge code="IN-IT-0101" revision="B" name="Shaft Housing" size="row" />
            <ItemBadge code="IN-IT-0101" revision="B" name="Shaft Housing" size="card" />
            <ItemBadge code="IN-IT-0101" name="Shaft Housing" size="page" codeColor="var(--text)" />
            <ItemBadge code="IN-IT-0101" name="Shaft Housing" size="tile" />
          </Row>
        </State>
        <State label="No name · no image · missing code · clickable · extra lines">
          <Row gap="var(--sp-5)">
            <ItemBadge code="IN-IT-0102" showName={false} />
            <ItemBadge code="IN-IT-0102" name="End Cover" showImage={false} />
            <ItemBadge code={null} name="Off-master line" />
            <ItemBadge
              code="IN-IT-0103"
              name="Bearing Sleeve"
              onClick={() => undefined}
              onOpenImage={() => setOpenImage(true)}
            />
            <ItemBadge code="IN-IT-0103" name="Bearing Sleeve" size="card">
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                Job Card IN-JC-00819 · JWSO IN-JW-0021
              </span>
            </ItemBadge>
          </Row>
          {openImage ? (
            <Banner tone="info" onDismiss={() => setOpenImage(false)}>
              The picture click fired — a real screen opens the file preview here.
            </Banner>
          ) : null}
        </State>
        <State label="ItemThumbnailHeader + ItemThumbnailCell — the picture gets its own column">
          <table className="innovic-table">
            <thead>
              <tr>
                <ItemThumbnailHeader />
                <th>Item</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {PICKER_ITEMS.map((it) => (
                <tr key={it.id}>
                  <ItemThumbnailCell alt={it.name} />
                  <td className="td-left">
                    <ItemBadge code={it.code} name={it.name} showImage={false} />
                  </td>
                  <td>120</td>
                </tr>
              ))}
            </tbody>
          </table>
        </State>
        <State label="ItemImageBox on its own — placeholder · clickable">
          <Row gap="var(--sp-4)">
            <ItemImageBox size="row" alt="row" />
            <ItemImageBox size="card" alt="card" />
            <ItemImageBox size="page" alt="page" onOpen={() => undefined} />
          </Row>
        </State>
      </Panel>

      <Panel title="DataTable — regular density (the list sheet)">
        <DataTable
          columns={columns}
          rows={DEMO_ROWS}
          sortBy={sort.sortBy}
          sortDir={sort.sortDir}
          onSort={(field) => setSort((s) => nextSort(field, s))}
          onRowClick={() => undefined}
          rowActions={() => (
            <RowActions
              onView={() => undefined}
              onEdit={() => undefined}
              onDelete={() => undefined}
            />
          )}
        />
        <ListFooter total={3} noun="job card" hint="Click a row to open its detail page." />
      </Panel>

      <Panel title="DataTable — compact density (a nested line table)">
        <DataTable columns={columns.slice(0, 5)} rows={DEMO_ROWS} density="compact" />
      </Panel>

      <Panel title="DataTable — editable (cells hold controls)">
        <DataTable
          editable
          density="compact"
          columns={[
            { header: 'Ln', width: '6%', nowrap: true, render: (_r, i) => i + 1 },
            {
              header: 'Item Code',
              width: '24%',
              align: 'left',
              stopRowClick: true,
              render: (row: DemoRow) => <Input defaultValue={row.doc} fieldWidth="md" mono />,
            },
            {
              header: 'Qty',
              width: '14%',
              stopRowClick: true,
              render: (row: DemoRow) => (
                <Input defaultValue={String(row.qty)} fieldWidth="sm" mono />
              ),
            },
            {
              header: 'UOM',
              width: '14%',
              stopRowClick: true,
              render: () => <Select options={SELECT_OPTIONS} fieldWidth="xs" />,
            },
            {
              header: '',
              width: '8%',
              stopRowClick: true,
              render: () => (
                <IconButton
                  icon={<Icon name="trash-2" size={12} />}
                  title="Remove line"
                  size="sm"
                />
              ),
            },
          ]}
          rows={DEMO_ROWS}
        />
      </Panel>

      <Panel title="DataTable — frozen first column (scrolls sideways)">
        <DataTable
          frozen
          columns={[...columns, ...columns.slice(1)].map((c, i) => ({
            ...c,
            width: `${100 / 13}%`,
            header: i === 0 ? c.header : `${String(c.header)} ${i}`,
          }))}
          rows={DEMO_ROWS}
        />
      </Panel>

      <Panel title="DataTable — loading · empty · sheet vs list variant">
        <State label="loading (skeleton rows)">
          <DataTable columns={columns.slice(0, 5)} rows={[]} loading />
        </State>
        <State label="empty">
          <DataTable
            columns={columns.slice(0, 5)}
            rows={[]}
            emptyText="No job cards match this filter."
          />
        </State>
        <State label='variant="list" (a plain list table)'>
          <DataTable columns={columns.slice(0, 4)} rows={DEMO_ROWS} variant="list" autoWidth />
        </State>
        <State label="maxHeight + footer row">
          <DataTable
            columns={columns.slice(0, 5)}
            rows={DEMO_ROWS}
            maxHeight="140px"
            footer={
              <tr>
                <td className="td-left" colSpan={3}>
                  <b>Total</b>
                </td>
                <td className="mono fw-700">144</td>
                <td className="mono fw-700">336</td>
              </tr>
            }
          />
        </State>
      </Panel>

      <Panel title="SortHeader — on its own">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>
                <SortHeader label="Ascending" active dir="asc" onSort={() => undefined} />
              </th>
              <th>
                <SortHeader label="Descending" active dir="desc" onSort={() => undefined} />
              </th>
              <th>
                <SortHeader label="Unsorted" onSort={() => undefined} />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel title="EmptyState">
        <State label="Tones — muted · ok · error">
          <EmptyState>No records</EmptyState>
          <EmptyState tone="ok" icon="✓">
            Everything is cleared
          </EmptyState>
          <EmptyState tone="error" icon="⚠">
            Could not load this panel
          </EmptyState>
        </State>
        <State label="inline (a tighter box inside a nested panel)">
          <EmptyState inline>No lines yet.</EmptyState>
        </State>
      </Panel>

      <Panel title="Skeleton">
        <State label="One bar · three lines · a block">
          <div style={{ display: 'grid', gap: 'var(--sp-3)', maxWidth: 420 }}>
            <Skeleton />
            <Skeleton lines={3} />
            <Skeleton height="72px" radius="var(--radius2)" />
            <Skeleton width="40%" />
          </div>
        </State>
      </Panel>

      <Panel title="Timeline">
        <State label="Regular density">
          <Timeline events={TIMELINE_EVENTS} title="Document trail" />
        </State>
        <State label="Compact density">
          <Timeline events={TIMELINE_EVENTS} density="compact" />
        </State>
        <State label="Empty">
          <Timeline events={[]} emptyText="Nothing has happened on this order yet." />
        </State>
      </Panel>

      <Panel title="RelatedDocs">
        <State label="Sections with counts; empty sections hidden by default">
          <RelatedDocs
            sections={RELATED_SECTIONS.map((s) => ({
              ...s,
              items: s.items.map((i) => ({
                ...i,
                status: <StatusBadge kind="doc" status="open" />,
              })),
            }))}
          />
        </State>
        <State label="showEmptySections — the NC tab stays visible and reads empty">
          <RelatedDocs sections={RELATED_SECTIONS} showEmptySections />
        </State>
      </Panel>

      <Panel title="MachineCard">
        <Row gap="var(--sp-3)">
          <MachineCard code="VMC-01" name="Haas VF-2" />
          <MachineCard
            code="VMC-02"
            name="DMG Mori"
            running
            jobCard="IN-JC-00818"
            itemCode="IN-IT-0102"
            itemTitle="End Cover"
            operation="OP20 Milling"
          />
          <MachineCard
            code="LATHE-03"
            name="Ace Micromatic"
            selected
            onSelect={() => undefined}
            jobCard="IN-JC-00817"
            itemCode="IN-IT-0101"
            operation="OP10 Turning"
          />
          <MachineCard
            code="GRIND-04"
            name="Under maintenance"
            extra={<Badge tone="red">Down</Badge>}
          />
        </Row>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// feedback
// ───────────────────────────────────────────────────────────────────────────

const BANNER_TONES: readonly BannerTone[] = ['info', 'warn', 'error', 'success'];
const PAGE_STATES: readonly PageStateKind[] = ['loading', 'error', 'empty', 'noaccess'];
const TOAST_KINDS: readonly ToastKind[] = ['ok', 'err', 'info'];
const MODAL_SIZES: readonly ModalSize[] = ['sm', 'md', 'lg'];

/** Shows what filePreviewKind() resolves a file name to. */
function filePreviewKindLabel(fileName: string): string {
  return filePreviewKind(fileName);
}

function ToastDemo() {
  const toast = useToast();
  return (
    <Row>
      <Button variant="success" size="sm" onClick={() => toast.ok('Sales Order saved.')}>
        Fire ok toast
      </Button>
      <Button variant="danger" size="sm" onClick={() => toast.error('Save failed — try again.')}>
        Fire error toast
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => toast.info('Refreshed 3 seconds ago.', { durationMs: 6000 })}
      >
        Fire info toast (6s)
      </Button>
      <Button variant="ghost" size="sm" onClick={() => toast.clear()}>
        Clear all
      </Button>
    </Row>
  );
}

function FeedbackSection() {
  const [modalSize, setModalSize] = useState<ModalSize | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedConfirmOpen, setTypedConfirmOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  return (
    <>
      <GroupHeading>feedback</GroupHeading>

      <Panel title="Banner — every tone">
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {BANNER_TONES.map((tone) => (
            <Banner key={tone} tone={tone} title={`${tone} banner`}>
              This operation has already been started — the balance can still be outsourced.
            </Banner>
          ))}
          <Banner tone="warn" accent>
            With a left accent bar, no title.
          </Banner>
          {dismissed ? null : (
            <Banner tone="info" onDismiss={() => setDismissed(true)}>
              Dismissible — click the × .
            </Banner>
          )}
          {dismissed ? (
            <Button variant="ghost" size="sm" onClick={() => setDismissed(false)}>
              Bring the dismissible banner back
            </Button>
          ) : null}
          <Banner tone="error" role="alert" title="Save failed">
            Job Card IN-JC-00819 could not be saved: upstream quantity is short by 40 Nos.
          </Banner>
        </div>
      </Panel>

      <Panel title="PageState — all four">
        <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
          {PAGE_STATES.map((state) => (
            <Panel key={state} title={`state="${state}"`}>
              <PageState state={state} />
            </Panel>
          ))}
          <Panel title="error with a retry action, placed as a page">
            <PageState
              state="error"
              as="page"
              title="Could not load Job Cards"
              message="The server did not answer in time."
              action={
                <Button size="sm" variant="ghost" icon={<Icon name="refresh-cw" size={12} />}>
                  Retry
                </Button>
              }
            />
          </Panel>
          <Panel title='as="row" inside a table' bodyPadding="none">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Job Card</th>
                  <th>Item</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                <PageState state="empty" as="row" colSpan={3} />
              </tbody>
            </table>
          </Panel>
          <Panel title='as="inline"'>
            <PageState state="loading" as="inline" />
          </Panel>
        </div>
      </Panel>

      <Panel title="Toast">
        <State label="Static — every kind">
          <div style={{ display: 'grid', gap: 'var(--sp-2)', maxWidth: 380 }}>
            {TOAST_KINDS.map((kind) => (
              <Toast key={kind} kind={kind} onDismiss={() => undefined}>
                {kind === 'ok'
                  ? 'Sales Order saved.'
                  : kind === 'err'
                    ? 'Save failed — try again.'
                    : 'Refreshed 3 seconds ago.'}
              </Toast>
            ))}
          </div>
        </State>
        <State label="Live — fires a real toast through the provider">
          <ToastDemo />
        </State>
      </Panel>

      <Panel title="Modal — live">
        <State label="Open one at each size">
          <Row>
            {MODAL_SIZES.map((size) => (
              <Button key={size} variant="ghost" onClick={() => setModalSize(size)}>
                Open {size}
              </Button>
            ))}
          </Row>
        </State>
        <State label="Inline preview (the same card, not portalled)">
          <Modal
            open
            inline
            title="Assign Task"
            footer={
              <>
                <Button variant="ghost">Cancel</Button>
                <Button variant="primary">Assign</Button>
              </>
            }
          >
            <FormGrid>
              <FormField label="Assign to" required size="lg">
                <SearchableSelect
                  value={null}
                  onChange={() => undefined}
                  options={SEARCHABLE_OPTIONS}
                  placeholder="Type to search…"
                />
              </FormField>
              <FormField label="Due" size="sm">
                <Input type="date" />
              </FormField>
            </FormGrid>
          </Modal>
        </State>
        <Modal
          open={modalSize !== null}
          size={modalSize ?? 'md'}
          title={`Modal — size ${modalSize ?? 'md'}`}
          onClose={() => setModalSize(null)}
          headerActions={<Badge tone="blue">Live</Badge>}
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalSize(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setModalSize(null)}>
                Save
              </Button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Escape closes it, the overlay click closes it, and focus is trapped inside while it is
            open.
          </p>
        </Modal>
      </Panel>

      <Panel title="ConfirmDialog — live">
        <State label="Danger (a delete) and a typed confirmation">
          <Row>
            <Button variant="danger" onClick={() => setConfirmOpen(true)}>
              Delete Job Card
            </Button>
            <Button variant="danger" onClick={() => setTypedConfirmOpen(true)}>
              Empty Trash (typed)
            </Button>
          </Row>
        </State>
        <State label="Inline preview">
          <ConfirmDialog
            open
            inline
            title="Discard your changes?"
            message="This Sales Order has unsaved edits."
            warnings={['2 lines were added', 'The client was changed']}
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            tone="danger"
          />
        </State>
        <ConfirmDialog
          open={confirmOpen}
          title="Delete IN-JC-00819?"
          message="The job card and its 3 operations are moved to Trash."
          warnings={['1 operation has already been started.']}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => setConfirmOpen(false)}
          onCancel={() => setConfirmOpen(false)}
        />
        <ConfirmDialog
          open={typedConfirmOpen}
          title="Empty the Trash?"
          message="Every soft-deleted row is destroyed permanently."
          confirmLabel="Empty Trash"
          tone="danger"
          requireTyped="DELETE"
          requireTypedLabel="Type DELETE to confirm"
          onConfirm={() => setTypedConfirmOpen(false)}
          onCancel={() => setTypedConfirmOpen(false)}
        />
      </Panel>

      <Panel title="FilePreview">
        <State label="Image · PDF · nothing to show · error · downloading">
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <FilePreview inline fileName="shaft-housing.jpg" kind="image" canDownload />
            <FilePreview inline fileName="SH-101-RevB.pdf" kind="pdf" canDownload />
            <FilePreview inline fileName="notes.txt" kind="none" />
            <FilePreview
              inline
              fileName="SH-101-RevB.pdf"
              kind="pdf"
              errorText="The signed link has expired. Reopen the document."
            />
            <FilePreview inline fileName="SH-101-RevB.pdf" kind="pdf" canDownload downloading />
          </div>
        </State>
        <State label="filePreviewKind() resolves the kind from the file name">
          <span style={{ fontFamily: 'var(--mono)', fontSize: 'var(--fs-xs)' }}>
            a.pdf → {filePreviewKindLabel('a.pdf')} · b.PNG → {filePreviewKindLabel('b.PNG')} ·
            c.txt → {filePreviewKindLabel('c.txt')}
          </span>
        </State>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// navigation
// ───────────────────────────────────────────────────────────────────────────

function NavigationSection() {
  const [pageTab, setPageTab] = useState('so');
  const [tab, setTab] = useState('inbox');
  const [status, setStatus] = useState<string | null>('open');
  const [view, setView] = useState<'list' | 'card'>('list');
  const [expandAll, setExpandAll] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const [dept, setDept] = useState('');

  return (
    <>
      <GroupHeading>navigation</GroupHeading>

      <Panel title="PageTabs — the open-page strip">
        <PageTabs
          tabs={[
            { key: 'so', label: 'Sales Orders', icon: '📋' },
            { key: 'jc', label: 'Job Cards', icon: '▭' },
            { key: 'po', label: 'Purchase Orders', icon: '🧾' },
          ]}
          activeKey={pageTab}
          onSelect={setPageTab}
          onClose={() => undefined}
        />
        <div style={{ marginTop: 'var(--sp-2)', fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
          Nothing open renders nothing at all:
        </div>
        <PageTabs tabs={[]} />
      </Panel>

      <Panel title="Breadcrumbs">
        <State label="Trail with links">
          <Breadcrumbs
            crumbs={[
              { label: 'Home', to: '/' },
              { label: 'Sales', to: '/sales-orders' },
              { label: 'IN-SO-00042' },
            ]}
            onNavigate={() => undefined}
          />
        </State>
        <State label="Single crumb">
          <Breadcrumbs crumbs={[{ label: 'Dashboard' }]} />
        </State>
      </Panel>

      <Panel title="TabStrip — with counts and a note">
        <State label="Default">
          <TabStrip
            tabs={[
              { key: 'inbox', label: 'Inbox', count: 7 },
              { key: 'outbox', label: 'Outbox', count: 2 },
              { key: 'todo', label: 'My To-Do', count: 0 },
              { key: 'all', label: 'All Tasks', note: 'admin only' },
            ]}
            activeKey={tab}
            onChange={setTab}
            label="Task views"
          />
        </State>
        <State label="No counts">
          <TabStrip
            tabs={[
              { key: 'a', label: 'Details' },
              { key: 'b', label: 'Lines' },
              { key: 'c', label: 'History' },
            ]}
            activeKey="a"
          />
        </State>
      </Panel>

      <Panel title="FilterBar">
        <State label="Search + filters + an extra control">
          <FilterBar
            search={filterSearch}
            onSearch={setFilterSearch}
            placeholder="Search job cards…"
            filters={[
              {
                key: 'status',
                label: 'Status',
                value: status ?? '',
                onChange: (v) => setStatus(v || null),
                options: ['', 'Open', 'QC Pending', 'Closed'],
              },
              {
                key: 'dept',
                label: 'Department',
                value: dept,
                onChange: setDept,
                options: [
                  { value: '', label: 'All departments' },
                  { value: 'prod', label: 'Production' },
                  { value: 'qc', label: 'Quality' },
                ],
              },
              { key: 'locked', label: 'Locked', options: ['—'], disabled: true },
            ]}
          >
            <Button size="sm" variant="ghost" icon={<Icon name="download" size={12} />}>
              Export
            </Button>
          </FilterBar>
        </State>
        <State label="Filters only (no search)">
          <FilterBar filters={[{ key: 'uom', options: ['Nos', 'Kg', 'Metre'] }]} />
        </State>
      </Panel>

      <Panel title="StatusPills / ViewToggle">
        <State label="StatusPills — All + options, one active">
          <StatusPills
            label="Status"
            options={['open', 'qc_pending', 'closed', 'cancelled']}
            value={status}
            onChange={setStatus}
          />
        </State>
        <State label="StatusPills — labelled options, nothing selected, with a right slot">
          <StatusPills
            options={[
              { value: 'todo', label: 'To Do' },
              { value: 'wip', label: 'In Progress' },
              { value: 'done', label: 'Completed' },
            ]}
            value={null}
            onChange={() => undefined}
            allLabel="Everything"
            right={<ViewToggle value={view} onChange={setView} />}
          />
        </State>
        <State label="ViewToggle — list / card, with Expand all">
          <Row>
            <ViewToggle
              value={view}
              onChange={setView}
              expandAll={expandAll}
              onExpandAll={() => setExpandAll((v) => !v)}
            />
          </Row>
        </State>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// layout
// ───────────────────────────────────────────────────────────────────────────

function LayoutSection() {
  const [expanded, setExpanded] = useState(true);
  const [page, setPage] = useState(2);

  return (
    <>
      <GroupHeading>layout</GroupHeading>

      <Panel title="PageHeader — the form / detail title row">
        <State label="Title + back + actions">
          <PageHeader
            title="New Sales Order"
            icon="📋"
            subtitle="Draft — nothing is saved yet"
            backLabel="Back to Sales Orders"
            onBack={() => undefined}
            actions={
              <>
                <Button variant="ghost">Cancel</Button>
                <Button variant="primary">Save Sales Order</Button>
              </>
            }
          />
        </State>
        <State label="Bare title">
          <PageHeader title="Settings" />
        </State>
      </Panel>

      <Panel title="ListHeader — the list title row">
        <State label="Full — count, search, tools, primary action">
          <ListHeader
            title="Sales Orders"
            icon="📋"
            count={42}
            noun="sales order"
            search=""
            onSearch={() => undefined}
            searchPlaceholder="Search this list…"
            tools={
              <>
                <Button size="sm" variant="ghost" icon={<Icon name="download" size={12} />}>
                  Export
                </Button>
                <Button size="sm" variant="ghost" icon={<Icon name="printer" size={12} />}>
                  Print
                </Button>
              </>
            }
            primary={
              <Button variant="primary" icon={<Icon name="plus" />}>
                New Sales Order
              </Button>
            }
          />
        </State>
        <State label="Updating (a background refetch) + a filter note">
          <ListHeader
            title="Job Cards"
            icon="▭"
            count={3}
            noun="job card"
            updating
            filterNote="filtered by Status: Open"
          />
        </State>
        <State label="Title only">
          <ListHeader title="Trash" />
        </State>
      </Panel>

      <Panel title="ListFooter — both modes">
        <State label="Scroll mode — all / capped / client-filtered / none">
          <ListFooter total={23} noun="sales order" hint="Click a row to open its detail page." />
          <ListFooter total={1240} limit={1000} noun="sales order" />
          <ListFooter total={42} shown={12} noun="vendor" />
          <ListFooter total={0} noun="GRN" />
        </State>
        <State label="Pager mode — unbounded registers only">
          <ListFooter
            total={312}
            page={page}
            pageSize={25}
            onPage={setPage}
            noun="entry"
            nounPlural="entries"
            actions={
              <>
                <Button size="sm" variant="ghost" icon={<Icon name="download" size={12} />}>
                  Download Excel Template
                </Button>
                <Button size="sm" variant="ghost" icon={<Icon name="upload" size={12} />}>
                  Import from Excel
                </Button>
              </>
            }
          />
        </State>
      </Panel>

      <Panel title="RowActions">
        <State label="Icons (default) · labelled · partial sets · with a confirm">
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            <RowActions
              onView={() => undefined}
              onEdit={() => undefined}
              onDelete={() => undefined}
            />
            <RowActions
              labelled
              onView={() => undefined}
              onEdit={() => undefined}
              onDelete={() => undefined}
            />
            <RowActions onView={() => undefined} />
            <RowActions
              onEdit={() => undefined}
              onDelete={() => undefined}
              deleteConfirm={{
                title: 'Delete this line?',
                message: 'The line is removed from the order.',
                confirmLabel: 'Delete line',
              }}
              extra={
                <IconButton icon={<Icon name="printer" size={12} />} title="Print" size="sm" />
              }
            />
          </div>
        </State>
      </Panel>

      <Panel title="DetailHeader + ReadGrid + ReadField">
        <DetailHeader
          code="IN-SO-00042"
          name="Larsen Engineering Works"
          backLabel="Back to Sales Orders"
          onBack={() => undefined}
          badges={
            <>
              <StatusBadge kind="so" status="open" />
              <Badge tone="purple">CPO 4500123456</Badge>
            </>
          }
          actions={
            <>
              <Button size="sm" variant="ghost" icon={<Icon name="printer" size={12} />}>
                Print
              </Button>
              <Button size="sm" variant="primary" icon={<Icon name="pencil" size={12} />}>
                Edit
              </Button>
            </>
          }
        >
          <ReadGrid>
            <ReadField label="SO Date" value="2026-09-01" mono size="sm" />
            <ReadField label="Delivery Date" value="2026-10-15" mono size="sm" />
            <ReadField label="POL" value="10" mono size="xs" />
            <ReadField label="Client" value="Larsen Engineering Works" size="lg" />
            <ReadField label="Closed On" size="sm" />
            <ReadField
              label="Remarks"
              value={'Two shipments.\nSecond one after the TPI clearance.'}
              pre
              full
            />
          </ReadGrid>
        </DetailHeader>
        <State label="ReadGrid — fixed equal columns (2 / 3 / 4)">
          <ReadGrid cols={4}>
            <ReadField label="Ordered" value="120" mono />
            <ReadField label="Dispatched" value="90" mono />
            <ReadField label="Balance" value="30" mono />
            <ReadField label="Rejected" value="0" mono />
          </ReadGrid>
        </State>
      </Panel>

      <Panel title="DocCard + LinesPanel — the card view of a list">
        <DocCard
          code="IN-SO-00042"
          accent="var(--blue)"
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          onOpen={() => undefined}
          title="Larsen Engineering Works"
          badges={<StatusBadge kind="so" status="open" />}
          actions={
            <Button size="sm" variant="ghost" icon={<Icon name="eye" size={12} />}>
              Open
            </Button>
          }
          metrics={
            <QtyStrip
              items={[
                { label: 'Ordered', value: 120 },
                { label: 'Dispatched', value: 90, color: 'var(--green2)' },
                { label: 'Balance', value: 30, color: 'var(--red2)' },
              ]}
            />
          }
          meta={['SO Date 2026-09-01', 'Delivery 2026-10-15', 'POL 10']}
        >
          <LinesPanel code="IN-SO-00042" onOpenDetail={() => undefined}>
            <DataTable
              columns={[
                { header: 'Ln', width: '8%', nowrap: true, render: (_r, i) => i + 1 },
                { header: 'Item', key: 'item', width: '52%', align: 'left', ellipsis: true },
                { header: 'Qty', key: 'qty', width: '20%', nowrap: true },
                {
                  header: 'Done',
                  key: 'done',
                  width: '20%',
                  nowrap: true,
                  headColor: 'var(--green)',
                },
              ]}
              rows={DEMO_ROWS}
              density="compact"
            />
          </LinesPanel>
        </DocCard>
        <State label="Collapsed, late (red accent), no lines">
          <DocCard
            code="IN-SO-00039"
            accent="var(--red2)"
            expanded={false}
            onToggle={() => undefined}
            title="Suzlon Energy Ltd"
            badges={<Badge tone="red">14 days late</Badge>}
            meta={['SO Date 2026-08-04', 'Delivery 2026-09-09']}
          />
        </State>
      </Panel>

      <Panel title="WorkList — the home page's what-to-do-next list">
        <State label="With items">
          <WorkList
            title="Needs you today"
            items={[
              {
                key: 'w1',
                severity: 'critical',
                icon: '⚠',
                title: 'IN-JC-00819 has been waiting 6 days',
                detail: 'OP30 Heat treatment · vendor not yet dispatched',
                age: 6,
                action: 'Open Job Card',
                onAction: () => undefined,
              },
              {
                key: 'w2',
                severity: 'warn',
                icon: '🧾',
                title: '3 Purchase Requests are waiting for approval',
                age: 2,
                action: 'Review',
                onAction: () => undefined,
              },
              {
                key: 'w3',
                severity: 'info',
                icon: '📋',
                title: 'IN-SO-00042 can be closed',
                detail: 'All lines dispatched',
                action: 'Close',
                onAction: () => undefined,
              },
            ]}
            more={{ label: 'See all 14', onClick: () => undefined }}
          />
        </State>
        <State label="Empty">
          <WorkList title="Needs you today" items={[]} emptyText="Nothing is waiting on you." />
        </State>
      </Panel>

      <Panel title="AttentionList / StatRow / QuickLinks">
        <State label="AttentionList — with items and empty">
          <AttentionList
            items={[
              {
                key: 'a1',
                icon: '⚠',
                label: '2 job cards are stuck at a vendor',
                severity: 'critical',
                onClick: () => undefined,
              },
              {
                key: 'a2',
                icon: '🧾',
                label: '3 PRs waiting for approval',
                severity: 'warn',
                onClick: () => undefined,
              },
              {
                key: 'a3',
                icon: '📦',
                label: '1 GRN pending incoming QC',
                severity: 'info',
                onClick: () => undefined,
              },
            ]}
          />
          <AttentionList items={[]} emptyText="Nothing needs attention." />
        </State>
        <State label="StatRow">
          <div style={{ display: 'grid', gap: 'var(--sp-1)', maxWidth: 420 }}>
            <StatRow icon="📋" label="Open Sales Orders" value={18} onClick={() => undefined} />
            <StatRow icon="▭" label="Running operations" value={7} />
            <StatRow icon="💰" label="Pending SO value" value="₹ 1,24,05,000" />
          </div>
        </State>
        <State label="QuickLinks">
          <QuickLinks
            title="Jump to"
            links={[
              {
                icon: '📋',
                label: 'Sales Orders',
                color: 'var(--dept-sales)',
                onClick: () => undefined,
              },
              {
                icon: '▭',
                label: 'Job Cards',
                color: 'var(--dept-production)',
                onClick: () => undefined,
              },
              {
                icon: '🧾',
                label: 'Purchase Orders',
                color: 'var(--dept-purchase)',
                onClick: () => undefined,
              },
              {
                icon: '🔬',
                label: 'Incoming QC',
                color: 'var(--dept-qc)',
                onClick: () => undefined,
              },
            ]}
          />
        </State>
      </Panel>

      <Panel title="LinkSlot — renders a button, a link, or plain text">
        <Row gap="var(--sp-4)">
          <LinkSlot onClick={() => undefined}>Click handler → a real button</LinkSlot>
          <LinkSlot
            to="/sales-orders"
            renderLink={({ to, children }) => <a href={to}>{children}</a>}
          >
            renderLink → a real anchor
          </LinkSlot>
          <LinkSlot>Neither → plain text</LinkSlot>
        </Row>
      </Panel>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Page
// ───────────────────────────────────────────────────────────────────────────

function UiKitPage(): React.JSX.Element {
  return (
    <ToastProvider>
      <div
        style={{
          padding: 'var(--content-pad)',
          display: 'grid',
          gap: 'var(--panel-gap)',
          background: 'var(--bg)',
          minHeight: '100vh',
        }}
      >
        <PageHeader
          title="UI Kit"
          icon="🎛"
          subtitle="Dev-only. Every primitive under apps/web/src/ui/, in every state. Sample data only — nothing here talks to the API."
          actions={<SyncDot state="ok" label={<span className="mono">DEV</span>} />}
        />
        <GroupHeading>tokens</GroupHeading>
        <TokenReference />
        <CoreSection />
        <FormsSection />
        <DataSection />
        <FeedbackSection />
        <NavigationSection />
        <LayoutSection />
      </div>
    </ToastProvider>
  );
}
