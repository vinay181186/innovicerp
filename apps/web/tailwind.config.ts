import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind extended with the Innovic palette + typography + spacing.
 *
 * Two layers of colours:
 *  1. The shadcn-style HSL slots (background / primary / muted / etc.)
 *     stay in place — index.css remaps their HSL values to Innovic
 *     colours, so unchanged shadcn primitives pick up the right look.
 *  2. The `innovic.*` namespace exposes hard-coded literals so a page
 *     can `bg-innovic-cyan` / `text-innovic-text2` when the shadcn
 *     vocabulary doesn't have the right slot (e.g. mono text colour,
 *     department tints, signal badges).
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
        // ─── Innovic namespace — literal hex from legacy ───────────
        innovic: {
          bg: '#f0f4f8',
          bg2: '#ffffff',
          bg3: '#f5f7fa',
          bg4: '#e8edf4',
          bg5: '#dce3ed',
          border: '#d1d9e6',
          border2: '#c5cfe0',
          border3: '#b0bed4',
          text: '#1a2235',
          text2: '#4a5a72',
          text3: '#7a8fa8',
          cyan: '#0088bb',
          cyan2: '#006694',
          cyan3: '#dff0f7',
          amber: '#c47a00',
          amber2: '#a06200',
          amber3: '#fff4d6',
          green: '#16a34a',
          green2: '#15803d',
          green3: '#dcfce7',
          red: '#dc2626',
          red2: '#b91c1c',
          red3: '#fee2e2',
          blue: '#2563eb',
          blue2: '#1d4ed8',
          blue3: '#dbeafe',
          orange: '#ea6c00',
          orange2: '#c25a00',
          purple: '#7c3aed',
        },
        dept: {
          planning: '#6d4ab8',
          sales: '#128a3e',
          store: '#a96300',
          design: '#6d4ab8',
          production: '#006f8f',
          qc: '#b83030',
          purchase: '#1e4db3',
          finance: '#0b776e',
          tasks: '#6d4ab8',
          system: '#4b5563',
        },
        sig: {
          critical: '#dc2626',
          warn: '#c47a00',
          ok: '#16a34a',
          info: '#2563eb',
          neutral: '#64748b',
        },
      },
      fontFamily: {
        // Match legacy CSS variables. font-sans defaults to Barlow.
        sans: ['Barlow', 'sans-serif'],
        heading: ['"Barlow Condensed"', 'sans-serif'],
        mono: ['"Source Code Pro"', 'monospace'],
      },
      fontSize: {
        // Innovic-specific density — denser than Tailwind defaults.
        'innovic-mono': ['10px', '14px'],
        'innovic-label': ['11px', '15px'],
        'innovic-control': ['13px', '18px'],
        'innovic-body': ['14px', '20px'],
        'innovic-heading': ['17px', '22px'],
        'innovic-section': ['22px', '28px'],
        'innovic-stat': ['32px', '34px'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        'innovic-card': '12px',
      },
      spacing: {
        // Sidebar + topbar fixed sizes from legacy.
        sidebar: '220px',
        topbar: '54px',
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
