// Join a list of import warnings/failures for the status line, capping at 50 so
// a huge sheet can't produce an unbounded banner, but still showing far more
// than the old 3-item cap that hid most problems. Same helper the Operator
// Master importer uses.

export function fmtImportList(items: string[]): string {
  const shown = items.slice(0, 50).join('; ');
  return items.length > 50 ? `${shown} … (+${items.length - 50} more)` : shown;
}
