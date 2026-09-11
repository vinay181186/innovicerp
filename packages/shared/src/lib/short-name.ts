// A person's name, short enough to sit in a QC entry field.
//
// SHARED ON PURPOSE. The web side shows it and stamps it on the record; the API
// writes the same form when QC Command's Assign and Take stamp an inspector.
// Two implementations would put two spellings of one person into
// `qc_assignments.inspector_name` and `op_log.operator_name`, and the Inspector
// Performance table keys on that TEXT -- so one person would appear twice.
//
// "Jinal Jayantibhai Rohit" -> "Jinal R."
//
// ONE RULE, NO EXCEPTIONS: the first word, then the initial of the last word.
// Gujarati names here are written Given / Father's / Surname, so the first word
// is the person and the last is the family -- the middle drops out because it is
// the part nobody is called by.
//
// A name entered SURNAME-FIRST would come out backwards ("Prajapati Aashvi" ->
// "Prajapati A."), and there is no way to tell that from the text: five of the
// six two-word names in the company are ordinary Given + Surname, so a rule
// that flipped two-word names would break all five. That case is therefore
// fixed in the DATA, not here -- the one record was corrected to
// "Aashvi Prajapati" (2026-09-11). Keep new users in that order and this needs
// no list of surnames and no maintenance.

/**
 * The display form of a full name. Blank in, blank out.
 *
 * - `Jinal Jayantibhai Rohit` → `Jinal R.`
 * - `Daman Patel` → `Daman P.`
 * - `dummy` → `dummy` (one word: there is no surname to initial)
 * - `someone@example.com` → unchanged (see below)
 */
export function shortName(full: string | null | undefined): string {
  const s = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return '';
  // The QC panels fall back to the e-mail when a user has no full name. An
  // address is not a name -- initialising it would produce nonsense like
  // "vinay.makwana24@gmail.com" -> "vinay.makwana24@gmail.com C." -- so it is
  // handed back exactly as it came.
  if (s.includes('@')) return s;

  const parts = s.split(' ');
  const first = parts[0] ?? '';
  if (parts.length === 1) return first;

  // Spread, not [0]: a surname could begin with a character outside the basic
  // plane, and indexing a string would cut it in half.
  const last = parts[parts.length - 1] ?? '';
  const initial = [...last][0] ?? '';
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
