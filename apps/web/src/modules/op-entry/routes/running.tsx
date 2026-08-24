import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ShopFloorView } from '@/modules/shop-floor/components/shop-floor-view';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useRealtimeRunningOps, useRunningOps } from '../api';
import { RunningOpsBoard } from '../components/running-ops-board';

export const runningOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-entry/running',
  component: RunningOpsPage,
});

function RunningOpsPage(): React.JSX.Element {
  useRealtimeRunningOps();
  const { data, isLoading, isFetching, isError, error } = useRunningOps();
  const [view, setView] = useState<'table' | 'machine'>('table');

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
          gap: 8,
        }}
      >
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            Live Operations Board
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            Real-time view of running shop-floor sessions.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
            </span>
          ) : null}
          <Link to="/op-entry" className="btn btn-ghost btn-sm">
            <ArrowLeft size={14} /> Op Entry
          </Link>
        </div>
      </div>

      <div style={{display:'flex',gap:4,borderBottom:'1px solid var(--border)',marginBottom:14}}>
        {(['table','machine'] as const).map((v)=>(<button key={v} type="button" onClick={()=>setView(v)} style={{background:'none',border:'none',borderBottom:view===v?'2px solid var(--cyan)':'2px solid transparent',color:view===v?'var(--cyan)':'var(--text3)',fontSize:12,fontWeight:700,padding:'6px 12px',cursor:'pointer',marginBottom:-1}}>{v==='table'?'📊 Table':'🏭 By Machine'}</button>))}
      </div>

      {view === 'machine' ? (
        <ShopFloorView />
      ) : isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
          </div>
        </div>
      ) : isError ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load running ops'}
          </div>
        </div>
      ) : (
        <RunningOpsBoard rows={data ?? []} />
      )}
    </div>
  );
}
