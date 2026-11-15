import { Banner, Button, FloatingPanel, Select, Textarea } from '@innovic/web';

const noop = () => {};

export const ChatPanel = () => (
  <FloatingPanel
    inline
    title="Ask ERP"
    subtitle="Live ERP data · read only · nothing is changed"
    onClose={noop}
    headerActions={
      <Select fieldWidth="sm" options={['Auto', 'Claude', 'Gemini']} defaultValue="Auto" />
    }
    footer={
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        <Textarea placeholder="e.g. Open job cards due this week" />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <Button size="sm" variant="ghost">
            Attach
          </Button>
          <Button size="sm" variant="primary">
            Send
          </Button>
        </div>
      </div>
    }
  >
    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text2)' }}>
      Ask about orders, stock, job cards, purchase or quality.
    </div>
  </FloatingPanel>
);

export const WithNotice = () => (
  <FloatingPanel inline title="Ask ERP" subtitle="Live ERP data · read only" onClose={noop}>
    <Banner flush tone="warn">
      Claude credit is finished — Gemini answered instead.
    </Banner>
  </FloatingPanel>
);
