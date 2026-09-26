// Backup & Export — admin-only.
//
// Mirror of legacy renderBackup (HTML L21963). Simplified: this page
// surfaces (a) per-table row counts as a sanity overview, (b) a JSON
// download of the company's data, and (c) a callout pointing to the
// real backup discipline (Supabase auto + daily pg_dump → B2 per
// RUNBOOK). Restore / Factory Reset are deferred per ADR — not safe
// to expose in-app without a typed-confirmation flow.

import { useMutation, useQuery } from '@tanstack/react-query';
import { createRoute } from '@tanstack/react-router';
import { Download, Loader2, Lock } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';

interface BackupStat {
  table: string;
  label: string;
  count: number;
}

interface BackupStatsResponse {
  collections: BackupStat[];
  totalRecords: number;
  lastBackupAt: string | null;
}

export const backupRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'backup',
  component: BackupPage,
});

function useBackupStats(enabled: boolean) {
  return useQuery<BackupStatsResponse>({
    queryKey: ['backup', 'stats'],
    queryFn: () => apiFetch<BackupStatsResponse>('/backup/stats'),
    enabled,
  });
}

function useDownloadBackup() {
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      // Direct fetch (not apiFetch) so we can stream the blob.
      const { supabase } = await import('@/lib/supabase');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
      const resp = await fetch(`${apiBase}/backup/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      a.href = url;
      a.download = `InnovicERP_Backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}

function BackupPage(): React.JSX.Element {
  const { data: me } = useSession();
  const isAdmin = me?.role === 'admin';
  const { data, isLoading, isError, error } = useBackupStats(isAdmin);
  const download = useDownloadBackup();

  if (!isAdmin) {
    return (
      <div className="panel">
        <div className="panel-body empty-state" style={{ color: 'var(--amber2)' }}>
          <Lock size={14} style={{ display: 'inline', marginRight: 6 }} />
          Admin access required for Backup & Export.
        </div>
      </div>
    );
  }

  const total = data?.totalRecords ?? 0;
  const collections = data?.collections ?? [];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          💾 Backup & Export
        </div>
      </div>

      {/* Summary cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
          marginBottom: 16,
        }}
      >
        <div className="panel" style={{ padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 11 }}>BACKUP SCHEDULE</div>
          <div className="mono fw-700" style={{ fontSize: 12, color: 'var(--green2)' }}>
            Daily 02:00 IST<br />→ Backblaze B2
          </div>
        </div>
      </div>

      {/* Action panel */}
      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>📤 Export Options</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            {download.isPending ? (
              <>
                <Loader2 className="inline h-4 w-4 animate-spin" /> Preparing…
              </>
            ) : (
              <>
                <Download size={14} /> Download JSON Backup
              </>
            )}
          </button>
        </div>
        <div className="text3" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.6 }}>
          Max 5,000 rows per table. Full backup runs every night.
        </div>
        {download.isError ? (
          <div
            style={{
              marginTop: 10,
              padding: '8px 12px',
              background: 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              color: 'var(--red2)',
              fontSize: 12,
            }}
          >
            {download.error instanceof Error
              ? download.error.message
              : 'Could not download backup. Try again.'}
          </div>
        ) : null}
      </div>

      {/* Collection details */}
      <div className="panel">
        <div style={{ padding: '10px 14px', background: 'var(--bg4)' }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>📊 Collection Details ({collections.length})</span>
        </div>
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Collection</th>
                <th className="td-ctr">Records</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={2} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={2} className="empty-state" style={{ color: 'var(--red2)' }}>
                    {error instanceof Error
                      ? error.message
                      : 'Could not load backup figures. Try again.'}
                  </td>
                </tr>
              ) : (
                collections.map((c) => (
                  <tr key={c.table}>
                    <td>
                      <span className="fw-700" style={{ color: 'var(--cyan)', fontSize: 12 }}>
                        {c.label}
                      </span>
                    </td>
                    <td className="td-ctr mono fw-700">{c.count.toLocaleString('en-IN')}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700, background: 'var(--bg4)' }}>
                <td>TOTAL</td>
                <td className="td-ctr mono">{total.toLocaleString('en-IN')}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
