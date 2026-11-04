// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { Modal } from './Modal';

afterEach(cleanup);

const QUESTION = 'Are you sure you want to exit?';

function Form({ onClose, onCancel }: { onClose: () => void; onCancel?: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal
      title="New thing"
      onClose={onClose}
      footer={
        <button type="button" onClick={onCancel ?? onClose}>
          Cancel
        </button>
      }
    >
      <input aria-label="qty" value={v} onChange={(e) => setV(e.target.value)} />
    </Modal>
  );
}

const overlay = (): Element => document.querySelector('.overlay') as Element;
const type = (): void => {
  fireEvent.change(screen.getByLabelText('qty'), { target: { value: '5' } });
};

describe('Modal closing rule (owner 2026-11-04)', () => {
  it.each([
    ['outside click', () => fireEvent.mouseDown(overlay())],
    ['Esc', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
    ['×', () => fireEvent.click(screen.getByTitle('Close'))],
    ['Cancel', () => fireEvent.click(screen.getByText('Cancel'))],
  ])('untouched: %s closes at once', (_n, act) => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    act();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it.each([
    ['outside click', () => fireEvent.mouseDown(overlay())],
    ['Esc', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
    ['×', () => fireEvent.click(screen.getByTitle('Close'))],
    ['Cancel', () => fireEvent.click(screen.getByText('Cancel'))],
  ])('typed: %s asks first and does not close', (_n, act) => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    type();
    act();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(QUESTION)).toBeTruthy();
  });

  it('Stay keeps the typing; Exit runs the footer Cancel once', () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    render(<Form onClose={onClose} onCancel={onCancel} />);
    type();
    fireEvent.click(screen.getByText('Cancel'));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByText(QUESTION)).toBeNull();
    expect((screen.getByLabelText('qty') as HTMLInputElement).value).toBe('5');
    fireEvent.click(screen.getByText('Cancel'));
    fireEvent.click(screen.getByRole('button', { name: /^exit/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['Cancel PR', 'Close SO', 'Back'])('typed: footer %s runs at once', (label) => {
    const action = vi.fn();
    render(
      <Modal
        title="X"
        onClose={vi.fn()}
        footer={
          <button type="button" onClick={action}>
            {label}
          </button>
        }
      >
        <input aria-label="qty" />
      </Modal>,
    );
    type();
    fireEvent.click(screen.getByText(label));
    expect(action).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it('a keyboard pick (native change only) counts as a change', () => {
    const onClose = vi.fn();
    render(<Form onClose={onClose} />);
    screen.getByLabelText('qty').dispatchEvent(new Event('change', { bubbles: true }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(QUESTION)).toBeTruthy();
  });

  it("Esc with a column menu open is the menu's, not the pop-up's", () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose}>
        <button type="button" aria-haspopup="dialog" aria-expanded="true">
          Status
        </button>
      </Modal>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('while a save runs nothing closes and nothing asks', () => {
    const onClose = vi.fn();
    render(
      <Modal title="X" onClose={onClose} closeLocked>
        <input aria-label="qty" />
      </Modal>,
    );
    type();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(overlay());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it('a body way out with data-modal-exit asks; Stay returns focus to the form', () => {
    const cancel = vi.fn();
    render(
      <Modal title="X" onClose={vi.fn()}>
        <input aria-label="qty" />
        <button type="button" data-modal-exit onClick={cancel}>
          Cancel
        </button>
      </Modal>,
    );
    type();
    screen.getByLabelText('qty').focus();
    fireEvent.click(screen.getByText('Cancel'));
    expect(cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText('Cancel')[1] as Element);
    expect(document.activeElement).toBe(screen.getByLabelText('qty'));
  });

  it('a view-only pop-up never asks', () => {
    const onClose = vi.fn();
    render(
      <Modal title="View" onClose={onClose} confirmExit={false}>
        <input aria-label="qty" />
      </Modal>,
    );
    type();
    fireEvent.mouseDown(overlay());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
