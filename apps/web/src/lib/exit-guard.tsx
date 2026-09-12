// "Are you sure you want to exit?" — the one guard every create / edit screen
// uses (user, 2026-09-12).
//
// WHAT IT CATCHES. Every way OUT of a form that is not one of its own buttons:
//   - the ESC key
//   - the browser's Back / Forward
//   - any in-app link: the breadcrumb, the back arrow, the sidebar, a row link
//   - closing or refreshing the tab (the browser shows its own generic prompt
//     there; a page cannot put its own words on that one)
//
// WHAT IT DOES NOT CATCH, on purpose. The form's own Save / Close / Cancel.
// Those already do the right thing and the user asked for them to stay as they
// are. A screen wraps the navigation those buttons make in `leave(...)`, which
// lets that one navigation through untouched.
//
// WHY A SCREEN HAS TO OPT IN with two lines rather than the guard being
// automatic: the router cannot tell a Save button's `navigate()` from a
// breadcrumb click -- both are a PUSH -- so the screen has to say which of its
// navigations are the deliberate exits. Everything else is treated as an
// attempt to leave and gets the question.
//
// Usage, in a route component:
//
//   const exit = useExitConfirm({ onExit: goBackToList });
//   ...
//   onSuccess: (row) => exit.leave(() => navigate({ to: '/x/$id', params: { id: row.id } }))
//   <Link to="/x" onClick={exit.allow}>Cancel</Link>
//   ...
//   return (
//     <>
//       {exit.dialog}
//       ...the form...
//     </>
//   );
//
// Render `dialog` on the FORM, not on the loading / no-access / not-found
// states: the guard is armed only while it is mounted, so those states let a
// Back link through -- there is nothing on them to lose.
//
// `onExit` is what ESC's "Exit" button does -- normally the same thing the
// screen's Cancel does. Without it the guard goes back one page in history,
// or to the parent path when there is no history to go back to.

import { useBlocker, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface ExitConfirmOptions {
  /** Where ESC's Exit goes. Defaults to history back, then the parent path. */
  onExit?: () => void;
  /** Switch the guard off, e.g. while the record is still loading. */
  enabled?: boolean;
}

export interface ExitConfirm {
  /** Run a navigation WITHOUT the question -- Save, Close, Cancel. */
  leave: (go: () => void) => void;
  /** The same thing for a `<Link>`: put it on the link's onClick and the
   *  navigation the link then makes goes through unasked. For Cancel links. */
  allow: () => void;
  /** Render this once, anywhere in the screen's tree. */
  dialog: React.ReactNode;
}

// ESC pressed while a type-to-search dropdown is open is that dropdown's key,
// not ours: the picker closes on it without stopping propagation, so the guard
// has to look for the open state itself. `aria-expanded` is set by the shared
// SearchableSelect on its combobox input.
export function escapeBelongsToAnOpenPicker(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const box = target.closest('[role="combobox"]');
  return box?.getAttribute('aria-expanded') === 'true';
}

function parentPath(pathname: string): string {
  const parts = pathname.replace(/\/+$/, '').split('/');
  parts.pop();
  return parts.join('/') || '/';
}

export function useExitConfirm(opts: ExitConfirmOptions = {}): ExitConfirm {
  const enabled = opts.enabled ?? true;
  const router = useRouter();
  const navigate = useNavigate();
  // True for exactly one navigation: the one the screen's own button makes.
  const bypass = useRef(false);
  // True only while the screen is actually showing `dialog`. A screen renders
  // it on its form, not on its loading / no-access / not-found states -- and
  // on those there is nothing to lose, so the guard must stand down: blocking
  // a navigation with nowhere to put the question would leave a Back link
  // that does nothing.
  const mounted = useRef(false);
  // The ESC popup. Navigation-triggered popups are the router's blocker, below.
  const [escOpen, setEscOpen] = useState(false);

  const armed = (): boolean => enabled && mounted.current && !bypass.current;
  const blocker = useBlocker({
    shouldBlockFn: armed,
    enableBeforeUnload: armed,
    withResolver: true,
  });

  // Open the door for exactly one navigation. It shuts again on the next tick,
  // so a navigation that never happened (a mutation that threw before
  // navigating, say) does not leave it open for the next click.
  const allow = useCallback(() => {
    bypass.current = true;
    window.setTimeout(() => {
      bypass.current = false;
    }, 0);
  }, []);

  const leave = useCallback(
    (go: () => void) => {
      allow();
      go();
    },
    [allow],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!mounted.current) return;
      if (escapeBelongsToAnOpenPicker(e.target)) return;
      // Something else is already asking; ESC must not stack a second popup.
      if (blocker.status === 'blocked') return;
      setEscOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, blocker.status]);

  const escExit = useCallback(() => {
    setEscOpen(false);
    leave(() => {
      if (opts.onExit) {
        opts.onExit();
      } else if (window.history.length > 1) {
        // `back()` is not blocked here and now -- the router only consults
        // blockers on the browser's popstate, which lands a task LATER than
        // the one-tick bypass window. Without this flag the guard would ask
        // a second time on the way out.
        router.history.back({ ignoreBlocker: true });
      } else {
        void navigate({ to: parentPath(router.state.location.pathname) });
      }
    });
  }, [leave, navigate, opts, router]);

  const open = escOpen || blocker.status === 'blocked';
  const onExit = blocker.status === 'blocked' ? blocker.proceed : escExit;
  const onStay = blocker.status === 'blocked' ? blocker.reset : () => setEscOpen(false);

  // Always an element, even when nothing is open: its mounting is what arms
  // the guard (see `mounted`).
  const dialog = <ExitGuardMount mounted={mounted} open={open} onExit={onExit} onStay={onStay} />;

  return { leave, allow, dialog };
}

function ExitGuardMount({
  mounted,
  open,
  onExit,
  onStay,
}: {
  mounted: React.MutableRefObject<boolean>;
  open: boolean;
  onExit: () => void;
  onStay: () => void;
}) {
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, [mounted]);
  return open ? <ExitConfirmDialog onExit={onExit} onStay={onStay} /> : null;
}

// The popup. Same overlay and modal chrome as every other dialog in the app,
// sized down: a question needs a card, not a workspace.
//
// Exported for the modal forms, which do not navigate and so cannot use the
// router blocker above -- they ask the same question on ESC and on a click
// outside, and call it with a `zIndex` above their own overlay.
export function ExitConfirmDialog({
  onExit,
  onStay,
  zIndex = 600,
}: {
  onExit: () => void;
  onStay: () => void;
  zIndex?: number;
}) {
  const stayRef = useRef<HTMLButtonElement>(null);
  // Cancel takes focus, so a stray Enter keeps the form rather than losing it.
  useEffect(() => {
    stayRef.current?.focus();
  }, []);
  return (
    <div
      className="overlay"
      style={{ alignItems: 'center', justifyContent: 'center', zIndex }}
      role="presentation"
      onMouseDown={(e) => {
        // Clicking the dim background is the same as Cancel: stay.
        if (e.target === e.currentTarget) onStay();
      }}
    >
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exit-confirm-title"
        style={{ maxWidth: 420, minHeight: 0 }}
        onKeyDown={(e) => {
          // ESC inside the popup means "no, stay" -- and must not reach the
          // window listener, which would open the popup again.
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onStay();
          }
        }}
      >
        <div className="modal-hdr">
          <div id="exit-confirm-title" className="modal-title">
            Are you sure you want to exit?
          </div>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px' }}>
          <p style={{ margin: 0, color: 'var(--text2)', fontSize: 13 }}>
            Anything entered on this form will be lost.
          </p>
        </div>
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button ref={stayRef} type="button" className="btn btn-ghost btn-sm" onClick={onStay}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={onExit}>
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
