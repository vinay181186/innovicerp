import { Panel, Skeleton } from '@innovic/web';

export const SingleBar = () => (
  <div style={{ width: 320 }}>
    <Skeleton width="60%" />
  </div>
);

export const Paragraph = () => (
  <div style={{ width: 320 }}>
    <Skeleton lines={4} />
  </div>
);

export const LoadingCard = () => (
  <div style={{ width: 360 }}>
    <Panel title="SO Details">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Skeleton width="56px" height="56px" radius="var(--radius)" />
        <div style={{ flex: 1 }}>
          <Skeleton lines={3} />
        </div>
      </div>
    </Panel>
  </div>
);
