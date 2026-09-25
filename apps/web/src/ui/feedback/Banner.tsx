// Banner — the ONE in-page notice.
//
// Replaces the ad-hoc notices the app grew: the JC rework/repair banner
// (modules/job-cards/components/jc-recovery-banner.tsx, hard-coded amber with
// no tone prop), the login screen's own Tailwind-styled status strip, and ~23
// files that improvised a notice out of `.panel` + `role="alert"`. Two of
// those files carry a comment justifying "why a banner and not a toast" —
// the distinction is kept here on purpose:
//
//   Banner = a condition that is TRUE while the page is open ("this card is a
//            rework of IN-JC-26-0085", "3 lines have no rate"). It stays.
//   Toast  = the result of something the user just did ("✓ SO saved"). It goes.
//
// `accent` is the JC recovery banner's 4px left bar — a notice that identifies
// the whole document rather than flagging one field.

import { Icon } from '../core/Icon';
import { IconButton } from '../core/IconButton';

/** success is the design reference's `ok`, spelled the way the rest of this
 *  app already spells it (`.btn-success`, `--sig-ok`).
 *
 *  UNRESOLVED, for the parent: ui/data/EmptyState.tsx spells the same idea
 *  `ok`, and so does design-ref/components/feedback/Banner.d.ts:4. One fact
 *  must end up with one name (CLAUDE.md §18). It is NOT renamed here because
 *  modules/ui-kit/routes/page.tsx:1626 already lists `'success'` in a
 *  `readonly BannerTone[]`, and that file is under modules/, which this phase
 *  may not touch — the rename has to land in the same change as its callers. */
export type BannerTone = 'info' | 'warn' | 'error' | 'success';

interface ToneStyle {
  bg: string;
  border: string;
  fg: string;
}

const TONES: Record<BannerTone, ToneStyle> = {
  // Text colours are the dark "2" variants: the solid signal colours are
  // FILLS only and fail 4.5:1 as text on their own pale wash (tokens.css).
  info: { bg: 'var(--sig-info-bg)', border: 'var(--sig-info-bd)', fg: 'var(--blue2)' },
  warn: { bg: 'var(--amber3)', border: 'var(--amber)', fg: 'var(--amber2)' },
  error: { bg: 'var(--red3)', border: 'var(--red)', fg: 'var(--red2)' },
  success: { bg: 'var(--green3)', border: 'var(--green)', fg: 'var(--green2)' },
};

export interface BannerProps {
  tone?: BannerTone;
  /** The headline. Bold, in the tone's colour. May carry document links. */
  title?: React.ReactNode;
  /** The detail under the title — or the whole message when there is no title. */
  children?: React.ReactNode;
  /** 4px left bar + 8px radius: this notice is about the whole document. */
  accent?: boolean;
  /** Renders a × on the right. Omitted = the notice cannot be dismissed. */
  onDismiss?: () => void;
  /** Drop the bottom margin (inside a dialog or a gap-spaced stack). */
  flush?: boolean;
  /** `alert` interrupts a screen reader; `status` waits its turn. Errors that
   *  block the user are `alert`; everything else stays `status`. */
  role?: 'status' | 'alert';
}

export function Banner({
  tone = 'warn',
  title,
  children,
  accent = false,
  onDismiss,
  flush = false,
  role = 'status',
}: BannerProps): React.JSX.Element {
  const t = TONES[tone];
  return (
    <div
      role={role}
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        ...(accent ? { borderLeft: `4px solid ${t.border}` } : {}),
        borderRadius: accent ? 'var(--radius2)' : 'var(--radius)',
        padding: accent ? 'var(--sp-2) var(--sp-3)' : 'var(--sp-3)',
        marginBottom: flush ? 0 : 'var(--sp-3)',
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'flex-start',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <div
            className="fw-700"
            style={{
              fontSize: 'var(--fs-sm)',
              color: t.fg,
              display: 'flex',
              gap: 'var(--sp-1)',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            {title}
          </div>
        ) : null}
        {children ? (
          <div
            style={{
              // With a title the body is secondary detail; alone, it IS the
              // notice and keeps the tone's colour.
              fontSize: title ? 'var(--fs-xs)' : 'var(--fs-sm)',
              color: title ? 'var(--text2)' : t.fg,
              marginTop: title ? 'var(--sp-0)' : 0,
            }}
          >
            {children}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <IconButton
          size="sm"
          title="Dismiss"
          icon={<Icon name="x" size={13} />}
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}
