import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // This terminal synchronises browser-only state (localStorage, the WIB
      // clock, media queries) inside effects. The React Compiler's synchronous
      // setState advisory cannot be satisfied without moving that state to an
      // external store, so keep it off rather than papering over it per line.
      'react-hooks/set-state-in-effect': 'off',
      // Compiler-only memoization advisory; the existing useMemo hooks are
      // intentional and there is no correctness issue behind the warning.
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    // External payload boundaries. These modules parse third-party JSON
    // (Yahoo, FRED, GDELT, GDACS) or untyped Supabase rows, so `any` is allowed
    // here only; new application logic still has to be typed.
    files: [
      'app/api/**/*.ts',
      'components/StockDetailModal.tsx',
      'lib/weekly-positions.ts',
      'lib/macro-risk.ts',
      'proxy.ts',
      'utils/supabase/**/*.ts',
      'scripts/**/*.ts',
    ],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]);

export default eslintConfig;
