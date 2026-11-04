// The ONE closing rule of a pop-up (owner 2026-11-04): a click outside, Esc, the × and
// the footer's Cancel / Close all ask "Are you sure you want to exit?" when something
// was typed or picked; an untouched pop-up closes at once. It reads the same changes as
// the page guard (lib/exit-guard.tsx), so no screen tracks its own "dirty".
//
// A way out that sits in the pop-up's body instead of its footer carries the
// `data-modal-exit` attribute.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { clickIsAnEdit, ExitConfirmDialog, isExitControl } from '@/lib/exit-guard';

interface CloseRuleArgs {
  active: boolean;
  /** Ask at all (false = view-only pop-up). */
  confirmExit: boolean;
  /** A save is running: nothing closes, nothing asks. */
  closeLocked: boolean;
  questionZIndex: number;
  cardRef: RefObject<HTMLDivElement>;
  footerRef: RefObject<HTMLDivElement>;
  onCloseRef: RefObject<(() => void) | undefined>;
}

interface CloseRule {
  requestClose: () => void;
  /** Esc while the question is up means "stay". True when it took the key. */
  escapeAnswersQuestion: () => boolean;
  cardHandlers: {
    onInputCapture: (e: { target: EventTarget }) => void;
    onMouseDownCapture: (e: { target: EventTarget }) => void;
    onClickCapture: (e: MouseEvent<HTMLDivElement>) => void;
  };
  question: ReactNode;
}

export function useCloseRule(args: CloseRuleArgs): CloseRule {
  const { active, confirmExit, closeLocked, questionZIndex, cardRef, footerRef, onCloseRef } = args;
  const dirtyRef = useRef(false);
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);
  askingRef.current = asking;
  const lockedRef = useRef(closeLocked);
  lockedRef.current = closeLocked;
  const askAllowedRef = useRef(confirmExit && active);
  askAllowedRef.current = confirmExit && active;
  // Set while the way out's own click re-runs after "Exit": it goes through.
  const passExitClick = useRef(false);
  const afterExit = useRef<(() => void) | null>(null);
  const focusBack = useRef<HTMLElement | null>(null);

  const ask = useCallback(
    (then: (() => void) | null) => {
      const el = document.activeElement;
      focusBack.current =
        el instanceof HTMLElement && cardRef.current?.contains(el) ? el : cardRef.current;
      afterExit.current = then;
      setAsking(true);
    },
    [cardRef],
  );

  const requestClose = useCallback(() => {
    if (lockedRef.current) return;
    if (askAllowedRef.current && dirtyRef.current) ask(null);
    else onCloseRef.current?.();
  }, [ask, onCloseRef]);

  const stay = useCallback(() => {
    setAsking(false);
    // Back into the form, or Tab would walk the page behind the overlay.
    focusBack.current?.focus();
  }, []);

  const escapeAnswersQuestion = useCallback(() => {
    if (!askingRef.current) return false;
    stay();
    return true;
  }, [stay]);

  const markIfEdit = (target: EventTarget | null, isClick: boolean): void => {
    if (!(target instanceof Element)) return;
    // A pick from a picker portaled to <body> still counts; a pop-up opened from
    // this one is its own form.
    const own = cardRef.current?.contains(target) || target.closest('[role="option"]') !== null;
    if (!own) return;
    if (!isClick || clickIsAnEdit(target)) dirtyRef.current = true;
  };
  const markRef = useRef(markIfEdit);
  markRef.current = markIfEdit;

  // A native listener: SearchableSelect's keyboard pick sends a native `change` that
  // React's onChange ignores (searchable-select.tsx pick()).
  useEffect(() => {
    const card = cardRef.current;
    if (!active || !card) return;
    const onChange = (e: Event): void => markRef.current(e.target, false);
    card.addEventListener('change', onChange);
    return () => card.removeEventListener('change', onChange);
  }, [active, cardRef]);

  const onClickCapture = (e: MouseEvent<HTMLDivElement>): void => {
    const button = e.target instanceof Element ? e.target.closest('button') : null;
    const wayOut =
      button &&
      (button.hasAttribute('data-modal-exit') ||
        (footerRef.current?.contains(button) &&
          isExitControl(button) &&
          // A footer's Back is a step inside the pop-up (an import's review step).
          !/back/i.test(button.textContent ?? '')));
    if (
      wayOut &&
      !passExitClick.current &&
      !lockedRef.current &&
      askAllowedRef.current &&
      dirtyRef.current
    ) {
      e.preventDefault();
      e.stopPropagation();
      ask(() => {
        passExitClick.current = true;
        button.click();
        passExitClick.current = false;
      });
      return;
    }
    markIfEdit(e.target, true);
  };

  return {
    requestClose,
    escapeAnswersQuestion,
    cardHandlers: {
      onInputCapture: (e) => markIfEdit(e.target, false),
      onMouseDownCapture: (e) => markIfEdit(e.target, true),
      onClickCapture,
    },
    question: asking ? (
      <ExitConfirmDialog
        zIndex={questionZIndex}
        onStay={stay}
        onExit={() => {
          setAsking(false);
          const go = afterExit.current;
          afterExit.current = null;
          if (go) go();
          else onCloseRef.current?.();
        }}
      />
    ) : null,
  };
}
