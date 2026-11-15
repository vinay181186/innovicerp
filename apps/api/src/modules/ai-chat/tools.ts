// ADR-293 — THE allow-list of what the AI chat may look up. Every tool calls an
// EXISTING read service with the read-only user context (every transaction READ
// ONLY, 8 s cap). There is no tool that writes, and no tool that takes SQL.
import {
  GLOBAL_SEARCH_MAX_CHARS,
  GLOBAL_SEARCH_MIN_CHARS,
  globalSearchQuerySchema,
  REPORT_COLUMN_FILTER_PREFIX,
  REPORT_GRID_PARAM_PREFIX,
} from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { globalSearch } from '../global-search/service';
import { listItems } from '../items/service';
import { listReports, runReport } from '../reports/service';
import { getStockAvailability } from '../store-inventory/service';
import { TOOL_ROW_CAP } from './compact';
import {
  DOC_KINDS,
  type DocKindName,
  LINE_KINDS,
  type LineKindName,
  LIST_KINDS,
  type ListArgs,
  type ListKind,
  type ListKindName,
  rowsOf,
} from './list-kinds';
import type { ToolParamSchema, ToolSpec } from './providers/types';
import type { AiChatToolName } from './tool-names';

export interface AiTool {
  spec: ToolSpec;
  /** Plain name for "Looked up: …" (e.g. "Purchase Orders list"). */
  label(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, roUser: AuthContext): Promise<unknown>;
}

/** A non-empty trimmed string, else undefined (the model sends "" for "none"). */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function listArgs(a: Record<string, unknown>): ListArgs {
  return {
    search: str(a.search),
    status: str(a.status),
    fromDate: str(a.fromDate),
    toDate: str(a.toDate),
  };
}

function kindHelp(kinds: Record<string, ListKind>): string {
  return Object.entries(kinds)
    .map(([k, v]) => {
      const bits = [v.statuses ? `status one of ${v.statuses.join('/')}` : 'no status filter'];
      if (v.hasDates) bits.push('fromDate/toDate');
      return `${k} (${v.label}: ${bits.join(', ')})`;
    })
    .join('; ');
}

const s = (description: string, extra: Partial<ToolParamSchema> = {}): ToolParamSchema => ({
  type: 'string',
  description,
  ...extra,
});
const DATE = 'YYYY-MM-DD, inclusive';
const listParams = (kinds: Record<string, ListKind>): ToolParamSchema => ({
  type: 'object',
  properties: {
    kind: s('Which list', { enum: Object.keys(kinds) }),
    search: s('Free text: document no., item code / name, customer / vendor'),
    status: s('Status filter word (see the kind list)'),
    fromDate: s(`Document date from, ${DATE}`),
    toDate: s(`Document date to, ${DATE}`),
  },
  required: ['kind'],
});

function pickKind<V>(kinds: Record<string, V>, raw: unknown): V {
  const k = str(raw);
  const v = k && Object.prototype.hasOwnProperty.call(kinds, k) ? kinds[k] : undefined;
  if (!v) {
    throw new Error(`Unknown kind "${String(raw)}". Use one of: ${Object.keys(kinds).join(', ')}`);
  }
  return v;
}

async function runList(kind: ListKind, args: Record<string, unknown>, user: AuthContext) {
  const res = await kind.run(listArgs(args), user);
  const total = (res as { total?: unknown } | null)?.total;
  return { total: typeof total === 'number' ? total : undefined, rows: rowsOf(res) };
}

function sameCode(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** [{key, value}] pairs from the model, as strings; anything else is skipped. */
function pairs(raw: unknown, k: string, v: string): Array<[string, string]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<[string, string]> = [];
  for (const p of raw as Array<Record<string, unknown>>) {
    const key = str(p?.[k]);
    const value = str(p?.[v]);
    if (key && value) out.push([key, value]);
  }
  return out;
}

export const AI_TOOLS = {
  search_documents: {
    spec: {
      name: 'search_documents',
      description:
        'Search every ERP document and master by number, code, party or item (the top search box). Use first when you only have a number or a name.',
      parameters: {
        type: 'object',
        properties: {
          query: s(`${GLOBAL_SEARCH_MIN_CHARS}-${GLOBAL_SEARCH_MAX_CHARS} characters`),
        },
        required: ['query'],
      },
    },
    label: () => 'ERP search',
    run: (a, user) =>
      globalSearch(globalSearchQuerySchema.parse({ q: a.query, limit: TOOL_ROW_CAP }), user),
  },

  list_documents: {
    spec: {
      name: 'list_documents',
      description: `List documents or masters, at most ${TOOL_ROW_CAP} rows plus the total count. Kinds: ${kindHelp(LIST_KINDS)}.`,
      parameters: listParams(LIST_KINDS),
    },
    label: (a) => LIST_KINDS[a.kind as ListKindName]?.label ?? 'Document list',
    run: (a, user) => runList(pickKind<ListKind>(LIST_KINDS, a.kind), a, user),
  },

  list_lines: {
    spec: {
      name: 'list_lines',
      description: `List order LINES (one row per line, with Pending Qty and the line Due Date), at most ${TOOL_ROW_CAP} rows plus the total count. Kinds: ${kindHelp(LINE_KINDS)}.`,
      parameters: listParams(LINE_KINDS),
    },
    label: (a) => LINE_KINDS[a.kind as LineKindName]?.label ?? 'Order lines',
    run: (a, user) => runList(pickKind<ListKind>(LINE_KINDS, a.kind), a, user),
  },

  get_document: {
    spec: {
      name: 'get_document',
      description:
        'Open ONE document by its number (e.g. IN-SO-00012, an Internal SO No., a JC No.) and return its full detail with lines.',
      parameters: {
        type: 'object',
        properties: {
          kind: s('Document kind', { enum: Object.keys(DOC_KINDS) }),
          code: s('The document number exactly as shown'),
        },
        required: ['kind', 'code'],
      },
    },
    label: (a) => DOC_KINDS[a.kind as DocKindName]?.label ?? 'Document',
    run: async (a, user) => {
      const kind = pickKind(DOC_KINDS as Record<string, (typeof DOC_KINDS)[DocKindName]>, a.kind);
      const code = str(a.code);
      if (!code) throw new Error('code is required');
      const rows = rowsOf(await kind.list.run({ search: code, includeCancelled: true }, user));
      const hit = rows.find((r) => kind.codeKeys.some((k) => sameCode(r[k], code)));
      const id = hit?.[kind.idKey];
      if (typeof id !== 'string') return { found: false, searched: code };
      return { found: true, document: await kind.get(id, user) };
    },
  },

  item_stock: {
    spec: {
      name: 'item_stock',
      description:
        'Live stock of one item by Item Code: in stock, reserved, available (the Store figures).',
      parameters: {
        type: 'object',
        properties: { itemCode: s('Item Code exactly as shown') },
        required: ['itemCode'],
      },
    },
    label: () => 'Item stock',
    run: async (a, user) => {
      const code = str(a.itemCode);
      if (!code) throw new Error('itemCode is required');
      const res = await listItems({ search: code, limit: TOOL_ROW_CAP, offset: 0 }, user);
      const item = res.items.find((i) => sameCode(i.code, code));
      if (!item) return { found: false, searched: code };
      const stock = await getStockAvailability(item.id, user);
      return { found: true, item: { code: item.code, name: item.name }, stock };
    },
  },

  list_reports: {
    spec: {
      name: 'list_reports',
      description:
        'The ERP reports you may run: slug, title, description, filter keys (kind, options) and column keys/labels.',
      parameters: { type: 'object', properties: {} },
    },
    label: () => 'Reports catalogue',
    run: async (_a, user) => {
      const { reports } = await listReports(user);
      return reports.map((r) => ({
        slug: r.slug,
        title: r.title,
        description: r.description,
        filters: r.filters.map((f) => ({ key: f.key, kind: f.kind, options: f.options })),
        columns: r.columns.map((c) => ({ key: c.key, label: c.label })),
      }));
    },
  },

  run_report: {
    spec: {
      name: 'run_report',
      description: `Run one report (slug from list_reports): the first ${TOOL_ROW_CAP} rows plus the total row count.`,
      parameters: {
        type: 'object',
        properties: {
          slug: s('Report slug'),
          filters: {
            type: 'array',
            description: 'Report filters from list_reports (dates YYYY-MM-DD)',
            items: {
              type: 'object',
              properties: { key: s('Filter key'), value: s('Filter value') },
              required: ['key', 'value'],
            },
          },
          columnFilters: {
            type: 'array',
            description: 'Column filters: text to contain, or >5 / <=10 / =3 on a number column',
            items: {
              type: 'object',
              properties: { column: s('Column key'), term: s('Filter term') },
              required: ['column', 'term'],
            },
          },
        },
        required: ['slug'],
      },
    },
    label: (a) => `Report ${str(a.slug) ?? ''}`.trim(),
    run: async (a, user) => {
      const slug = str(a.slug);
      if (!slug) throw new Error('slug is required');
      const query: Record<string, string> = {};
      // Grid keys (_limit, _cf.…) are ours to set, never a report filter.
      for (const [k, v] of pairs(a.filters, 'key', 'value')) {
        if (!k.startsWith(REPORT_GRID_PARAM_PREFIX)) query[k] = v;
      }
      for (const [col, term] of pairs(a.columnFilters, 'column', 'term')) {
        query[`${REPORT_COLUMN_FILTER_PREFIX}${col}`] = term;
      }
      query[`${REPORT_GRID_PARAM_PREFIX}limit`] = String(TOOL_ROW_CAP);
      const res = await runReport(slug, query, user);
      return {
        title: res.title,
        rowCount: res.rowCount,
        columns: res.columns.map((c) => ({ key: c.key, label: c.label })),
        rows: res.rows,
        totals: res.totals,
      };
    },
  },
} satisfies Record<AiChatToolName, AiTool>;

export const AI_TOOL_SPECS: ToolSpec[] = Object.values(AI_TOOLS).map((t) => t.spec);

export function findTool(name: string): AiTool | undefined {
  return Object.prototype.hasOwnProperty.call(AI_TOOLS, name)
    ? AI_TOOLS[name as AiChatToolName]
    : undefined;
}
