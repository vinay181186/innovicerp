// ADR-309 — the "Desktop pop-ups" switch under the bell popover's heading
// (approved mockup 2026-11-18, panel 4). Hidden when the server is not set up
// for pop-ups or the browser cannot show them.

import { useDesktopPopups } from '@/lib/push/api';
import { Badge, Button } from '@/ui/core';
import { useToast } from '@/ui/feedback';

export function DesktopPopupsRow(): React.JSX.Element | null {
  const popups = useDesktopPopups();
  const toast = useToast();

  if (popups.state === 'unsupported' || popups.state === 'not-ready') return null;

  const turnOn = (): void => {
    popups.turnOn().catch(() => {
      toast.error('Could not turn on desktop pop-ups. Reload the page and try again.');
    });
  };
  const turnOff = (): void => {
    popups.turnOff().catch(() => {
      toast.error('Could not turn off desktop pop-ups. Try again.');
    });
  };
  const sendTest = (): void => {
    popups
      .sendTest()
      .then((r) => {
        if (r.sent > 0) toast.ok('Test pop-up sent');
        else
          toast.show('No test pop-up sent: pop-ups are not on for any laptop.', { kind: 'warn' });
      })
      .catch(() => {
        toast.error('Could not send the test pop-up. Try again.');
      });
  };

  return (
    <div className="nb-push">
      <div className="nb-push-text">
        <div className="nb-push-title">
          Desktop pop-ups {popups.state === 'on' ? <Badge tone="green">On</Badge> : null}
          {popups.state === 'off' ? <Badge tone="grey">Off</Badge> : null}
          {popups.state === 'blocked' ? <Badge tone="red">Blocked</Badge> : null}
        </div>
        <div className="nb-push-note">
          {popups.state === 'off'
            ? 'Laptop pop-up when a task is assigned to you or completed'
            : null}
          {popups.state === 'on' ? (
            <>
              On for this laptop ·{' '}
              <button
                type="button"
                className="dh-textbtn nb-push-link"
                disabled={popups.busy}
                onClick={sendTest}
              >
                Send test pop-up
              </button>
            </>
          ) : null}
          {popups.state === 'blocked'
            ? 'Blocked in the browser. Click 🔒 left of the address › Notifications › Allow, then reload.'
            : null}
        </div>
      </div>
      {popups.state === 'off' ? (
        <Button size="sm" loading={popups.busy} onClick={turnOn}>
          Turn on
        </Button>
      ) : null}
      {popups.state === 'on' ? (
        <Button size="sm" variant="ghost" loading={popups.busy} onClick={turnOff}>
          Turn off
        </Button>
      ) : null}
    </div>
  );
}
