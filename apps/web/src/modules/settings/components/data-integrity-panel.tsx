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
import { fmtDateTime } from '@/lib/date';
import { Banner } from '@/ui/feedback';

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
    // Legacy `<div class="panel mt-16">` (L13420); .mt-16 (L268) is not in our theme.
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">Data Integrity Check</span>
      </div>
      <div className="panel-body">
        <p className="text2" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
          Finds broken links and negative stock.
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
              Last run: {fmtDateTime(result.ranAt)}
            </span>
          ) : null}
        </div>

        {run.isError ? (
          <div style={{ marginTop: 12 }}>
            <Banner tone="error" role="alert">
              {run.error instanceof Error
                ? run.error.message
                : 'Could not run the data check. Try again.'}
            </Banner>
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
                      ? 'var(--green3)'
                      : r.severity === 'warn'
                        ? 'var(--amber3)'
                        : 'var(--red3)',
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
