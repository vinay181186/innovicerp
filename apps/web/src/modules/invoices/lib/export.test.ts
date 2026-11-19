import type { InvoiceListLineRow } from '@innovic/shared';
import { describe, expect, it, vi } from 'vitest';
import { invoiceLineExportRow, invoiceLinesHeader } from './export';

// The fetchers pull in the API client (and its env check); not needed here.
vi.mock('../api', () => ({ fetchInvoiceList: vi.fn(), fetchInvoiceLinesPage: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const line: InvoiceListLineRow = {
  lineId: '00000000-0000-4000-8000-000000000001',
  invoiceId: '00000000-0000-4000-8000-000000000002',
  invoiceCode: 'IN-INV-26-00001',
  invoiceDate: '2026-11-03',
  invoiceStatus: 'unpaid',
  dueDate: '2026-12-03',
  overdue: false,
  clientName: 'Acme',
  soCode: 'IN-SO-26-00521',
  soInternalNo: null,
  clientPoLineNo: '10',
  createdAt: '2026-11-03T09:00:00Z',
  createdByName: null,
  itemCode: 'SH-50',
  itemRevision: 'B',
  itemName: 'Shaft 50mm',
  qty: 4,
  rate: 250,
  lineAmount: 1000,
};

describe('invoice Lines sheet (ADR-310)', () => {
  it('keeps Rate and Amount for a price user, header and row the same width', () => {
    const header = invoiceLinesHeader(false);
    const row = invoiceLineExportRow(line, false);
    expect(header).toContain('Rate');
    expect(header).toContain('Amount');
    expect(row).toHaveLength(header.length);
    expect(row[header.indexOf('Rate')]).toBe(250);
    expect(row[header.indexOf('Amount')]).toBe(1000);
    expect(row[header.indexOf('Qty')]).toBe(4);
  });

  it('drops Rate and Amount from header AND row for a no-price user', () => {
    const header = invoiceLinesHeader(true);
    const row = invoiceLineExportRow(line, true);
    expect(header).not.toContain('Rate');
    expect(header).not.toContain('Amount');
    expect(row).toHaveLength(header.length);
    expect(row).not.toContain(250);
    expect(row).not.toContain(1000);
    expect(row[header.indexOf('Qty')]).toBe(4);
    expect(row[header.indexOf('Invoice Status')]).toBe('Unpaid');
  });
});
