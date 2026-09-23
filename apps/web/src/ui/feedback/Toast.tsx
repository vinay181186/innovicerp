// Toast — "✓ SO saved". The short, self-clearing confirmation of something
// the user just did.
//
// The CSS for this has existed since the legacy port (`.toast-item`,
// `.toast-ok/.toast-err/.toast-info`, `@keyframes toastSlideIn`) and NOTHING
// in React ever used it: there was no `toast()`, no provider, no store. So
// every screen put its save confirmation in a banner that never went away.
// This file is the missing plumbing.
//
// Banner vs Toast — the line, restated:
//   Banner = a condition that is true while the page is open. It stays.
//   Toast  = the outcome of one action. It slides in bottom-right and goes.
//
// Wiring, once, near the router root:
//   <ToastProvider>{app}</ToastProvider>
// then anywhere below it:
//   const toast = useToast();
//   toast.ok('✓ SO saved');
//   toast.error('Could not save — ' + e.message);
//
// `Toast` and `ToastStack` are plain presentational components as well, so the
// /__ui-kit page can render every kind without a provider or a timer.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../core/Icon';
import { Z_TOAST } from './Modal';

/** ok = it worked · err = it did not · info = it happened. */
export type ToastKind = 'ok' | 'err' | 'info';

/** How long a toast stays before it clears itself, in ms. Long enough to read
 *  a short past-tense line; an error gets longer because it is worth reading. */
const DEFAULT_MS: Record<ToastKind, number> = { ok: 3000, err: 6000, info: 4000 };

export interface ToastProps {
  kind?: ToastKind;
  children?: React.ReactNode;
  /** Renders a × on the toast. The stack passes this; a preview need not. */
  onDismiss?: () => void;
}

export function Toast({ kind = 'ok', children, onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className={`toast-item toast-${kind}`} role="status">
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
          style={{
            // Not `.btn-ghost`: the toast is a solid colour, so its × is the
            // toast's own white text at reduced strength, not a grey button.
            background: 'none',
            border: 0,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            color: 'inherit',
            opacity: 0.8,
            cursor: 'pointer',
          }}
        >
          <Icon name="x" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/** One live toast. `id` is what `dismiss()` takes. */
export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: React.ReactNode;
  /** 0 = stays until dismissed by hand. */
  durationMs: number;
}

export interface ToastStackProps {
  toasts?: ToastItem[];
  onDismiss?: (id: string) => void;
  /** Render the stack in place instead of fixed bottom-right (/__ui-kit). */
  inline?: boolean;
  /** Raw children, for a preview that has no ToastItem list. */
  children?: React.ReactNode;
}

export function ToastStack({
  toasts,
  onDismiss,
  inline = false,
  children,
}: ToastStackProps): React.JSX.Element {
  const style: React.CSSProperties = inline
    ? { display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }
    : {
        position: 'fixed',
        bottom: 'var(--sp-5)',
        right: 'var(--sp-5)',
        zIndex: Z_TOAST,
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--sp-2)',
      };
  // NO `aria-live` here. Every child Toast carries `role="status"`, which is
  // itself a polite live region (and is what
  // design-ref/components/feedback/Toast.jsx:3 puts on the item, with nothing
  // on the stack). A live region nested inside another makes some screen
  // readers announce each toast twice; the announcement lives on the item.
  return (
    <div style={style}>
      {(toasts ?? []).map((t) => (
        <Toast
          key={t.id}
          kind={t.kind}
          {...(onDismiss ? { onDismiss: () => onDismiss(t.id) } : {})}
        >
          {t.message}
        </Toast>
      ))}
      {children}
    </div>
  );
}

export interface ToastOptions {
  kind?: ToastKind;
  /** Override the default lifetime. 0 = stays until dismissed by hand. */
  durationMs?: number;
}

export interface ToastApi {
  /** Returns the toast's id, so a long-running action can dismiss its own. */
  show: (message: React.ReactNode, opts?: ToastOptions) => string;
  ok: (message: React.ReactNode, opts?: ToastOptions) => string;
  error: (message: React.ReactNode, opts?: ToastOptions) => string;
  info: (message: React.ReactNode, opts?: ToastOptions) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children?: React.ReactNode;
  /** How many stay on screen at once. The newest is at the BOTTOM of the
   *  stack, nearest the corner; the oldest falls off the top. */
  max?: number;
}

export function ToastProvider({ children, max = 4 }: ToastProviderProps): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
    setToasts([]);
  }, []);

  // A navigation away mid-timer must not leave a timeout pointing at a
  // setState on an unmounted provider.
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const timer of live.values()) window.clearTimeout(timer);
      live.clear();
    };
  }, []);

  const show = useCallback(
    (message: React.ReactNode, opts?: ToastOptions): string => {
      const kind = opts?.kind ?? 'ok';
      const durationMs = opts?.durationMs ?? DEFAULT_MS[kind];
      seq.current += 1;
      const id = `toast-${seq.current}`;
      setToasts((list) => [...list, { id, kind, message, durationMs }].slice(-max));
      if (durationMs > 0) {
        timers.current.set(
          id,
          window.setTimeout(() => {
            timers.current.delete(id);
            setToasts((list) => list.filter((t) => t.id !== id));
          }, durationMs),
        );
      }
      return id;
    },
    [max],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      ok: (message, opts) => show(message, { ...opts, kind: 'ok' }),
      error: (message, opts) => show(message, { ...opts, kind: 'err' }),
      info: (message, opts) => show(message, { ...opts, kind: 'info' }),
      dismiss,
      clear,
    }),
    [show, dismiss, clear],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Portalled so an `overflow:hidden` page wrapper cannot clip it, and so
          it always sits above the overlay ladder. */}
      {typeof document === 'undefined'
        ? null
        : createPortal(<ToastStack toasts={toasts} onDismiss={dismiss} />, document.body)}
    </ToastContext.Provider>
  );
}

/** Must be called under a <ToastProvider>. Throwing here is deliberate: a
 *  silent no-op would swallow every save confirmation on the screen that
 *  forgot to mount the provider. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast() needs a <ToastProvider> above it.');
  return api;
}
