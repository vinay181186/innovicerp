import { SyncDot } from '@innovic/web';

export const WithCaption = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <SyncDot state="ok" label="SYNCED" />
    <SyncDot state="offline" label="OFFLINE" />
    <SyncDot state="error" label="COULD NOT SAVE" />
  </div>
);

export const DotOnly = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
    <SyncDot state="ok" />
    <SyncDot state="offline" />
    <SyncDot state="error" />
  </div>
);
