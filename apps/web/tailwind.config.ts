import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind config — the shadcn HSL slots ONLY.
 *
 * index.css remaps those slots to Innovic colours, so an unchanged shadcn
 * primitive picks up the right look.
 *
 * There is deliberately NO `innovic.*` / `dept.*` / `sig.*` colour namespace
 * and no `fontSize.innovic-*` scale here any more (deleted 2026-09-23). They
 * were hand-copied hex/px literals — a third source of truth beside
 * styles/tokens.css and the index.css HSL block — and they had already gone
 * stale: `innovic.cyan` was #0088bb against the real --cyan #155eef, and
 * `innovic-stat` was 32px against the real --fs-stat 28px. Two files in the
 * whole app consumed them. Colour, type and spacing come from
 * styles/tokens.css, consumed by the class vocabulary in
 * styles/innovic-theme.css — that is the app's real styling system.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        // shadcn slots (HSL → mapped in index.css)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        // Match legacy CSS variables. font-sans defaults to Barlow.
        sans: ['Barlow', 'sans-serif'],
        heading: ['"Barlow Condensed"', 'sans-serif'],
        mono: ['"Source Code Pro"', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        'innovic-card': '12px',
      },
      spacing: {
        // Read the tokens rather than re-stating the numbers: these were
        // hand-copied and 'topbar' had already drifted (54px vs the real 48px).
        sidebar: 'var(--sidebar-width)',
        topbar: 'var(--topbar-height)',
      },
      boxShadow: {
        'innovic-card': '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        'innovic-modal': '0 24px 80px rgba(0, 0, 0, 0.6)',
        'innovic-menu': '0 6px 20px rgba(15, 23, 42, 0.15)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
