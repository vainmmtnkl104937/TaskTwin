import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const baseConfig = [
  {
    ignores: ['**/.next/**', '**/.turbo/**', '**/coverage/**', '**/dist/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
];

export default baseConfig;
