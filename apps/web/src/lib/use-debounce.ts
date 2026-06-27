// Generic debounce hook — returns `value` after it has stopped changing for
// `delayMs`. The project had no standalone debounce util (SearchableSelect
// debounced inline); this is the shared one used by useDocNumber + future forms.

import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
