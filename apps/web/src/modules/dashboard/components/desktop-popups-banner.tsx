// ADR-309 — the blue "Desktop pop-ups are off" band on every page (owner
// 2026-11-19, mockup https://claude.ai/artifact/XCBvQjZpJSMK12ZMqkMZc1). It sits
// under the Day Log band, has no close button and stays until pop-ups are On in
// this browser — also after a deliberate Turn off (owner: "should come back").
// The wording is generic, not task-specific (owner). A browser never lets a site
// switch pop-ups on by itself, so the band asks for the one click.
// Nothing while loading, where the browser cannot show pop-ups, when the server
// has no keys, or for someone whose Task Board is hidden (no pop-up would reach
// them today, §20.5).

import { useCanOpen } from '@/components/shared/action-link';
import { useDesktopPopups } from '@/lib/push/api';
import { Button } from '@/ui/core';

/** Shown after Turn on when the browser gave no answer (box closed or hidden).
 *  Generic on purpose: Chrome, Edge and Firefox put the icon in different places. */
export const ALLOW_HINT =
  'No box? Click the notification or site-settings icon in the address bar › Notifications › Allow.';
/** Blocked: only the browser's own setting can undo it. */
export const BLOCKED_HINT =
  'Click the site-settings icon at the left of the address bar › Notifications › Allow, then reload the page.';

export function DesktopPopupsBanner(): React.JSX.Element | null {
  const allowed = useCanOpen()('/task-board');
  const popups = useDesktopPopups();

  if (!allowed || (popups.state !== 'off' && popups.state !== 'blocked')) return null;

  if (popups.state === 'blocked') {
    return (
      <div className="popups-band popups-band-blocked" role="status">
        <b>Desktop pop-ups are blocked in this browser.</b>
        <span>{BLOCKED_HINT}</span>
      </div>
    );
  }

  return (
    <div className="popups-band" role="status">
      {popups.asking || popups.noAnswer ? (
        <>
          <b>Click Allow in the box your browser shows.</b>
          {popups.noAnswer ? <span>{ALLOW_HINT}</span> : null}
        </>
      ) : (
        <>
          <b>Desktop pop-ups are off on this computer.</b>
          <span>Turn them on to get Innovic ERP pop-ups on your screen.</span>
        </>
      )}
      <Button size="sm" className="popups-band-btn" loading={popups.busy} onClick={popups.turnOn}>
        Turn on
      </Button>
    </div>
  );
}
