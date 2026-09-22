/**
 * Mouse-wheel guard for number inputs.
 *
 * Browsers change the value of a FOCUSED <input type="number"> when the wheel
 * turns over it — a qty of 10 became 8 while the user was only scrolling the
 * page (user, 2026-09-21). One document-level listener covers every number
 * field in the app — the shared `Input` component, `.innovic-input` fields and
 * the ~55 screens that write a raw `<input type="number">` — without touching
 * any of them.
 *
 * How: when a wheel event lands on the focused number input, the input is
 * blurred BEFORE the browser applies the step, so the value is left alone and
 * the page still scrolls. Typing, arrow keys and the spinner keep working — the
 * user simply clicks the field again to continue editing after scrolling.
 * (Calling preventDefault instead would freeze page scrolling while the
 * pointer sits over a field, which is worse on long forms.)
 */
export function installNumberWheelGuard(doc: Document = document): () => void {
  const onWheel = (e: WheelEvent): void => {
    const el = doc.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'number' && e.target === el) {
      el.blur();
    }
  };
  // Capture phase so no component-level handler can run first; passive — we
  // never preventDefault, the page must keep scrolling.
  doc.addEventListener('wheel', onWheel, { capture: true, passive: true });
  return () => doc.removeEventListener('wheel', onWheel, { capture: true });
}
