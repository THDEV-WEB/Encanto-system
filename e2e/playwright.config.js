/* e2e/playwright.config.js — REF-E2E-01 · Onda 1 (infra).
   Config unica do Playwright. O app sobe via `vite --mode e2e` (webServer abaixo), que carrega
   .env.e2e (raiz do projeto) por convencao nativa do Vite — nenhum codigo novo em src/ para isso.
   Sem .env.e2e preenchido (VITE_SUPABASE_URL/KEY vazios), o app roda em modo degradado com o
   catalogo MOCK (src/data/mockCatalog.js) — deterministico, sem rede, sem tocar Supabase algum.
   Isso e o que permite esta Onda 1 (infra + specs read-only/locais) existir ANTES do projeto
   Supabase dedicado a E2E estar pronto (ver docs/adr/REF-E2E-01-auditoria-playwright.md). */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/* raiz do encanto-react (config vive em e2e/, o app e o vite.config.js vivem 1 nivel acima) */
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5183; // distinto do :5173 do `npm run dev` — nunca colide com o dev server do dono
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: CI,               // trava test.only esquecido em CI, sem incomodar localmente
  retries: CI ? 2 : 0,           // flake vira sinal localmente; em CI ganha 2 tentativas antes de reprovar
  workers: CI ? 1 : undefined,   // CI: 1 worker (evita contencao/flake em runner compartilhado); local: auto
  reporter: [
    ['list'],
    ['html', { outputFolder: './playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  /* Multi-browser desde o inicio (pedido do dono): os 3 engines ja configurados. Só o Chromium
     roda por padrão (`npm run test:e2e` passa --project=chromium); Firefox/WebKit ficam prontos
     para `npm run test:e2e:all-browsers` (ou `--project=firefox|webkit`) assim que os binários
     forem instalados (`npx playwright install firefox webkit` — não baixado nesta Onda). */
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],

  /* Sobe o app sozinho (local e CI) — `vite --mode e2e` carrega .env.e2e por convenção do Vite.
     reuseExistingServer só localmente: em CI cada run deve subir um server limpo. */
  webServer: {
    command: `npx vite --mode e2e --port ${PORT} --strictPort`,
    cwd: PROJECT_ROOT,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
