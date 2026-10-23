// ADR-250 — ONE per-person home for every user (replaces the admin /
// specialist / operator layouts of ADR-044). The server sends only the blocks,
// rows and actions the caller holds the right for; this file only lays them out.

import type { HomeResponse, HomeScope } from '@innovic/shared';
import { useState } from 'react';
import '../home.css';
import '../home-rows.css';
import { useNotificationsSeen } from '../use-notifications-seen';
import { ApprovalInbox } from './approval-inbox';
import { DashRowView, RowHead } from './dash-row';
import { HomeCustomize } from './home-customize';
import { HomeHeader, HomeHeadline, type HomeMode } from './home-header';
import { DashListPanel, HomePanel } from './home-panel';
import { DonePanel, NotificationsPanel, ShortcutsPanel, TodoPanel } from './home-side';
import { HomeWidgets } from './home-widgets';

export function HomePage({
  home,
  scope,
  onScope,
  updatedAt,
  onRefresh,
}: {
  home: HomeResponse;
  scope: HomeScope;
  onScope: (s: HomeScope) => void;
  updatedAt: number;
  onRefresh: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<HomeMode>('home');
  const seen = useNotificationsSeen(home.notifications);

  return (
    <div className="dh">
      <HomeHeader
        home={home}
        updatedAt={updatedAt}
        mode={mode}
        onMode={setMode}
        onRefresh={onRefresh}
        scope={scope}
        onScope={onScope}
        onBell={seen.openPanel}
      />
      {mode === 'customize' ? (
        <HomeCustomize onClose={() => setMode('home')} />
      ) : mode === 'widgets' ? (
        <HomeWidgets quickLinkPages={home.quickLinks} />
      ) : (
        <>
          <HomeHeadline home={home} />
          <div className="dh-grid">
            <div className="dh-col">
              {home.approvals ? (
                <ApprovalInbox approvals={home.approvals} sent={home.sentForApproval} />
              ) : null}
              {home.lists.map((l) => (
                <DashListPanel key={l.key} list={l} />
              ))}
              {home.waitingTotal > 0 ? (
                <HomePanel title="Waiting on others" count={home.waitingTotal}>
                  <RowHead head={['Document', 'Item', 'Qty', 'Waiting']} />
                  {home.waiting.map((r) => (
                    <DashRowView key={r.key} row={r} />
                  ))}
                </HomePanel>
              ) : null}
            </div>
            <div className="dh-col">
              <NotificationsPanel notes={home.notifications} panelRef={seen.panelRef} />
              <TodoPanel todo={home.todo} />
              <DonePanel done={home.done} />
              <ShortcutsPanel pages={home.quickLinks} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
