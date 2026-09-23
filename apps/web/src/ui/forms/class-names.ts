// Class-name joiner for the ui/forms primitives.
//
// The house style is class-based (.panel, .btn, .innovic-input, .form-grp), so
// every primitive composes theme classes and lets the caller add its own. This
// drops the falsy branches and collapses the spacing so the rendered markup
// matches what the theme expects.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
