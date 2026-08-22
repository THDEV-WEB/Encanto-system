import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

/* REF-DEVEX-01: projeto nunca teve linter (achado da auditoria do roadmap paralelo). Config
   deliberadamente permissiva no primeiro corte — objetivo é ligar o ESLint sem quebrar CI com
   centenas de avisos em código legado. Regras que pegaram muita violação real (ver
   docs/ref/REF-DEVEX-01-auditoria.md) ficam em 'warn'; o resto usa os presets recomendados. */
export default [
  {
    ignores: ['dist/**', 'android/**', 'node_modules/**', '.vercel/**', '.netlify/**', 'supabase/.temp/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, __APP_RELEASE__: 'readonly' },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      /* Só as 2 regras "classicas" do plugin (pre-v7) — o preset `recommended` hoje inclui as
         regras do React Compiler (immutability/purity/set-state-in-effect/etc.), pensadas pra quem
         vai adotar o Compiler. Este projeto e React 18 sem Compiler: aplicar esse preset inteiro
         marcaria como erro padroes idiomaticos e corretos (ex: useEffect(() => carregar(), [carregar])
         pra buscar dado ao montar), exigindo reescrita em massa sem ganho real. */
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Scripts de teste/verificacao legado (fora do runtime de producao) — achados reais mas de baixo
      // risco de "corrigir" sem entender profundamente cada fluxo de teste; ficam como aviso por ora.
      'no-useless-assignment': 'warn',
      'preserve-caught-error': 'warn',
    },
  },
  {
    // Specs Playwright: arquivo roda em Node, mas o corpo de vários callbacks (page.evaluate etc.) é
    // serializado e executado DENTRO do navegador — window/document ali são globals legítimos.
    files: ['e2e/**/*.js', 'e2e/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  prettierConfig,
];
