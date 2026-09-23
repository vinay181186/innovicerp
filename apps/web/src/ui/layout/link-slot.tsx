// LinkSlot — the one navigation wrapper the layout primitives use.
//
// ui/ must not import the router: a primitive has to render inside /__ui-kit
// with no route context. But a dashboard row that navigates must still be a
// real link (middle-click / ctrl-click / "open in new tab" are the reason the
// StatStrip rule forbids onClick+navigate()). So the caller passes `renderLink`
// — typically `(p) => <Link {...p} />` — and the slot stays router-free here.
//
// Precedence: renderLink + to → the caller's link · to alone → <a href> ·
// onClick alone → <button> reset to look like the <a> · neither → plain <div>.
// `onClick` is never dropped: it rides along on the link branches too, and on
// the router-free <a href> it takes over from the href so the SPA is not
// hard-reloaded.

import type { CSSProperties, ReactNode } from 'react';
import { isPlainLeftClick } from '../is-plain-left-click';

export interface RenderLinkArgs {
  to: string;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: string | undefined;
  /**
   * The caller's own side effect (close a menu, log the jump). Spread into
   * `<Link {...p} />` it runs alongside the navigation rather than instead of
   * it — it must not preventDefault.
   */
  onClick?: (() => void) | undefined;
  children: ReactNode;
}

/** Caller-supplied link renderer, e.g. `(p) => <Link {...p} />`. */
export type RenderLink = (args: RenderLinkArgs) => ReactNode;

export interface LinkSlotProps {
  /** Route path. With `renderLink` it becomes a real router link. */
  to?: string | undefined;
  onClick?: (() => void) | undefined;
  renderLink?: RenderLink | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  title?: string | undefined;
  /**
   * Strip the UA button chrome when this slot falls back to a <button>.
   *
   * Inline styles beat class rules, so the reset would otherwise silently win
   * the padding / display fight against whatever `className` says. Leave it on
   * (the default) when the className only paints — `.dash-link` sets colour,
   * decoration and radius and nothing else, so the button needs the reset to
   * read as the <a> it replaces. Turn it OFF when the className already draws
   * the whole control — `.btn`, `.btn-sm`, `.btn-icon` declare display,
   * height, padding and font, and the reset would flatten every one of them.
   */
  buttonReset?: boolean | undefined;
  children: ReactNode;
}

/** A <button> that carries no button chrome, so .dash-link styles it like the <a>. */
const BUTTON_RESET: CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

export function LinkSlot({
  to,
  onClick,
  renderLink,
  className,
  style,
  title,
  buttonReset = true,
  children,
}: LinkSlotProps): React.JSX.Element {
  if (to && renderLink) {
    return <>{renderLink({ to, className, style, title, onClick, children })}</>;
  }
  if (to) {
    return (
      <a
        href={to}
        className={className}
        style={style}
        title={title}
        // No router here, so a plain href would hard-reload the SPA. When the
        // caller gave an onClick as well, that is the navigation — run it and
        // keep the href for middle-click / "open in new tab".
        onClick={
          onClick
            ? (e): void => {
                // Ctrl/Cmd/Shift/middle-click means "open elsewhere" — let the
                // href do its job, exactly as the comment above promises.
                if (!isPlainLeftClick(e)) return;
                e.preventDefault();
                onClick();
              }
            : undefined
        }
      >
        {children}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        style={buttonReset ? { ...BUTTON_RESET, ...style } : style}
        title={title}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
  return (
    <div className={className} style={style} title={title}>
      {children}
    </div>
  );
}
