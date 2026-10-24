import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelect } from './searchable-select';

const options = [{ id: 'so:1', code: 'IN-SO-00010', name: 'Acme Engg' }];

describe('SearchableSelect clearable', () => {
  it('shows no × unless clearable and a value is picked', () => {
    const { rerender } = render(
      <SearchableSelect value="so:1" onChange={vi.fn()} options={options} onSearch={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    rerender(
      <SearchableSelect
        clearable
        value={null}
        onChange={vi.fn()}
        options={options}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('× empties the box, clears the value and keeps the cursor in the field', () => {
    const onChange = vi.fn();
    render(
      <SearchableSelect
        clearable
        value="so:1"
        valueLabel="IN-SO-00010 · Acme Engg"
        onChange={onChange}
        options={options}
        onSearch={vi.fn()}
      />,
    );
    const input = screen.getByRole<HTMLInputElement>('combobox');
    expect(input.value).toBe('IN-SO-00010 · Acme Engg');
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(null);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });
});
