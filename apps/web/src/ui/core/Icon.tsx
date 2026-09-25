// Icon — the ONE control-icon source (design-ref/components/core/Icon.jsx).
//
// The reference inlines 23 Lucide SVG paths so the design system needs no icon
// runtime. The app is not in that position: `lucide-react` is already a direct
// dependency and 234 files import from it, so duplicating the paths would give
// us two copies of the same glyphs that can drift. This is therefore a thin,
// typed wrapper over `lucide-react` — SAME names, same sizes (12–15px), same
// 2px default stroke as the reference.
//
// Rule of thumb (design-ref/README.md "Iconography"): page/module identity →
// emoji; control affordance (row actions, header buttons, chevrons) → Icon.
// Icon-only buttons always carry a title — see IconButton.

import type { CSSProperties } from 'react';
import {
  Activity,
  ArrowLeft,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  KeyRound,
  Loader2,
  LogOut,
  type LucideIcon,
  Package,
  Paperclip,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Square,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';

/** The fixed control-icon set. Adding a name here is a design decision, not a convenience. */
export type IconName =
  | 'search'
  /** Status / activity review — the SO detail's "Status" action. */
  | 'activity'
  | 'eye'
  | 'pencil'
  | 'trash-2'
  | 'download'
  | 'upload'
  | 'printer'
  | 'plus'
  | 'check'
  | 'x'
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-left'
  | 'key-round'
  | 'log-out'
  | 'bell'
  | 'package'
  | 'settings'
  | 'refresh-cw'
  | 'square'
  | 'user-round'
  | 'paperclip'
  | 'loader-2';

const GLYPHS: Record<IconName, LucideIcon> = {
  search: Search,
  activity: Activity,
  eye: Eye,
  pencil: Pencil,
  'trash-2': Trash2,
  download: Download,
  upload: Upload,
  printer: Printer,
  plus: Plus,
  check: Check,
  x: X,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'arrow-left': ArrowLeft,
  'key-round': KeyRound,
  'log-out': LogOut,
  bell: Bell,
  package: Package,
  settings: Settings,
  'refresh-cw': RefreshCw,
  square: Square,
  'user-round': UserRound,
  paperclip: Paperclip,
  'loader-2': Loader2,
};

/** Every name the Icon set carries — for the UI kit and for exhaustiveness checks. */
export const ICON_NAMES: readonly IconName[] = Object.keys(GLYPHS) as IconName[];

/**
 * Canonical icon per action (design-ref/components/core/Icon.prompt.md):
 * View eye · Edit pencil · Delete trash-2 · Export download · Import upload ·
 * Print printer · Add plus · Back arrow-left · Stop square · Assign user-round ·
 * Attach paperclip · Refresh refresh-cw · Loading loader-2.
 */
export interface IconProps {
  name: IconName;
  /** 12–15px. Default 14. */
  size?: number;
  /** A colour TOKEN (`var(--text3)`), never a hex. Defaults to currentColor. */
  color?: string;
  strokeWidth?: number;
  /** Accessible name. Omit for a decorative icon that sits next to its own label. */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 14,
  color,
  strokeWidth = 2,
  title,
  className,
  style,
}: IconProps) {
  const Glyph = GLYPHS[name];
  // `title` becomes an SVG <title> CHILD, as design-ref/components/core/Icon.jsx
  // does, not role="img" + aria-label. The child form gives BOTH the accessible
  // name and the browser's native hover tooltip; the aria form gives only the
  // name, so a standalone <Icon name="paperclip" title="Attachment" /> outside
  // a button lost its tooltip. Inside IconButton the title sits on the <button>
  // and this is invisible either way.
  return (
    <Glyph
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
    </Glyph>
  );
}
