// Builds the kit the converter reads (cfg.buildCmd). The app's env check needs VITE_* values
// at load; designs never call the API, so these are placeholders, not the real addresses.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.ds-sync/package.json', import.meta.url));
const esbuild = require('esbuild');

await esbuild.build({
  entryPoints: ['.design-sync/entry.ts'],
  outfile: 'apps/web/.ds-dist/index.js',
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  tsconfig: '.design-sync/tsconfig.json',
  nodePaths: ['apps/web/node_modules'],
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  loader: { '.svg': 'dataurl', '.png': 'dataurl' },
  define: {
    'import.meta.env': JSON.stringify({
      VITE_API_URL: 'https://design-preview.invalid',
      VITE_SUPABASE_URL: 'https://design-preview.invalid',
      VITE_SUPABASE_ANON_KEY: 'design-preview-placeholder-key',
    }),
  },
  // Packages written the old way call require('react'); hand them the page's one React.
  banner: {
    js: [
      "import * as __r from 'react';",
      "import * as __rd from 'react-dom';",
      "import * as __jsx from 'react/jsx-runtime';",
      "var require = (n) => ({ react: __r, 'react-dom': __rd, 'react/jsx-runtime': __jsx })[n];",
    ].join(' '),
  },
  logLevel: 'error',
});

// The ERP's fonts, as apps/web/index.html loads them.
const FONTS = [
  "@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800",
  'family=Barlow+Condensed:wght@700;800',
  'family=Source+Code+Pro:wght@400;600;700',
  'family=Public+Sans:wght@400;600;700',
  "family=JetBrains+Mono:wght@400;600;700&display=swap');",
].join('&');
const css = 'apps/web/.ds-dist/index.css';
// The app's whole stylesheet as main.tsx loads it (Tailwind base, tokens, theme): designs must
// get the same page rules as the ERP, or the shared dropdown and sizing come out wrong.
execSync('pnpm exec tailwindcss -i src/index.css -o .ds-dist/app.css', { cwd: 'apps/web', stdio: 'pipe' });
const app = readFileSync('apps/web/.ds-dist/app.css', 'utf8');
writeFileSync(css, `${FONTS}
${app}
${readFileSync(css, 'utf8')}
`);
