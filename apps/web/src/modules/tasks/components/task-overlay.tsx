// The one popup shell every Task Board modal uses — a thin wrapper over the ONE
// shared Modal (portal, overlay, Esc, focus trap, closing rule), holding on to
// the board's approved widths.
//
// `guard` — for the forms: closing asks "Are you sure you want to exit?" once
// something was typed or picked. Read-only popups (Task Detail) leave it off.
// `elevated` — for an action popup opened over Task Detail.

import { Modal } from '@/ui/feedback';

/** Widths from the approved board: Assign Task 600px, My To-Do 500px, Detail
 *  the app's wide sheet. */
export type OverlaySize = 'sm' | 'md' | 'lg';

const MAX_WIDTH: Record<'sm' | 'md', string> = { sm: '500px', md: '600px' };

export function Overlay(props: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  size?: OverlaySize | undefined;
  footer?: React.ReactNode;
  guard?: boolean | undefined;
  elevated?: boolean | undefined;
  /** Kept for the older callers: `wide` = size 'lg'. */
  wide?: boolean | undefined;
}): React.JSX.Element {
  const size: OverlaySize = props.size ?? (props.wide ? 'lg' : 'md');
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={props.footer}
      confirmExit={props.guard ?? false}
      elevated={props.elevated ?? false}
      {...(size === 'lg' ? { size } : { maxWidth: MAX_WIDTH[size] })}
    >
      {props.children}
    </Modal>
  );
}

/** The blue note box at the top of the two create forms. */
export function FormNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        padding: '8px 10px',
        background: 'var(--blue3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        marginBottom: 'var(--sp-3)',
        fontSize: 'var(--fs-xs)',
        color: 'var(--text2)',
      }}
    >
      {children}
    </div>
  );
}

export function FormError({ msg }: { msg: string | null }): React.JSX.Element | null {
  if (!msg) return null;
  return (
    <div role="alert" className="form-error" style={{ marginTop: 'var(--sp-2)' }}>
      {msg}
    </div>
  );
}
