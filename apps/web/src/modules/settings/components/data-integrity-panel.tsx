// Data Integrity Check panel — Settings page block.
//
// Mirror of legacy Settings page L13420–13429. Single "Run Integrity Check"
// button → calls GET /data-integrity → renders per-check rows with the
// matching severity colour. Read-only; no fixups (user reviews then fixes
// the underlying records via the relevant module).

import type { IntegrityCheckResponse } from '@innovic/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';

function fmtTs(ts: string): string {
  const dt = new Date(ts);
  return (
    dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ' ' +
    dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

function severityColor(s: 'ok' | 'warn' | 'error'): string {
  if (s === 'ok') return 'var(--green)';
  if (s === 'warn') return 'var(--amber)';
  return 'var(--red)';
}

function severityIcon(s: 'ok' | 'warn' | 'error'): string {
  if (s === 'ok') return '✅';
  if (s === 'warn') return '⚠';
  return '❌';
}

export function DataIntegrityPanel(): React.JSX.Element {
  const [result, setResult] = useState<IntegrityCheckResponse | null>(null);
  const run = useMutation<IntegrityCheckResponse, Error, void>({
    mutationFn: () => apiFetch<IntegrityCheckResponse>('/data-integrity'),
    onSuccess: (r) => setResult(r),
  });

  return (
    <div className="panel mt-16">
      <div className="panel-hdr">
        <span className="panel-title">🔗 Data Integrity Check</span>
      </div>
      <div className="panel-body">
        <p className="text2" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
          Scans all modules for broken linkages, orphan records, over-allocations, negative stock,
          and mismatched references across SO, JW, JC, PO, GRN, NC, Store.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => run.mutate()}
            disabled={run.isPending}
          >
            {run.isPending ? (
              <>
                <Loader2 className="inline h-4 w-4 animate-spin" /> Running…
              </>
            ) : (
              <>
                <Search size={14} /> Run Integrity Check
              </>
            )}
          </button>
          {result ? (
            <span className="text3" style={{ fontSize: 11 }}>
              Last run: {fmtTs(result.ranAt)}
            </span>
          ) : null}
        </div>

        {run.isError ? (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              color: 'var(--red)',
              fontSize: 12,
            }}
          >
            {run.error instanceof Error ? run.error.message : 'Integrity check failed'}
          </div>
        ) : null}

        {result ? (
          <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
            {result.results.map((r) => (
              <div
                key={r.code}
                style={{
                  padding: 10,
                  borderRadius: 6,
                  border: `1px solid ${severityColor(r.severity)}`,
                  background:
                    r.severity === 'ok'
                      ? 'rgba(34,197,94,0.04)'
                      : r.severity === 'warn'
                        ? 'rgba(245,158,11,0.04)'
                        : 'rgba(239,68,68,0.04)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ marginRight: 6 }}>{severityIcon(r.severity)}</span>
                    <span style={{ fontWeight: 700, color: severityColor(r.severity) }}>
                      {r.label}
                    </span>
                    <span className="text3" style={{ fontSize: 11, marginLeft: 8 }}>
                      ({r.code})
                    </span>
                  </div>
                  <span
                    className="mono fw-700"
                    style={{ fontSize: 16, color: severityColor(r.severity) }}
                  >
                    {r.count}
                  </span>
                </div>
                <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                  {r.detail}
                </div>
                {r.samples.length > 0 ? (
                  <div className="text2" style={{ fontSize: 11, marginTop: 4 }}>
                    <span className="text3">Samples:</span>{' '}
                    {r.samples.map((s, i) => (
                      <span key={i} className="mono" style={{ marginRight: 6 }}>
                        {s}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
