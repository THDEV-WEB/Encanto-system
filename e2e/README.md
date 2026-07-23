# e2e/ — Testes End-to-End (Playwright) — REF-E2E-01

Camada de testes que roda o app **inteiro, num browser real**, cobrindo os fluxos críticos de
negócio (catálogo, carrinho, checkout, login, Admin). Complementa — **não substitui** — a suíte de
domínio existente em `../tests/*.mjs` (golden tests, guards de RLS, smoke de render sem browser).

A auditoria completa (arquitetura, decisões, riscos, plano por ondas) está em
[`../docs/adr/REF-E2E-01-auditoria-playwright.md`](../docs/adr/REF-E2E-01-auditoria-playwright.md).
Leia lá antes de adicionar um novo spec — este README é só o "como rodar/onde fica o quê" do dia a dia.

## Como rodar

```powershell
npm run test:e2e            # só Chromium (padrão) — não precisa de nada além disto instalado
npm run test:e2e:ui         # modo interativo (UI mode do Playwright)
npm run test:e2e:headed     # com o browser visível
npm run test:e2e:report     # abre o último relatório HTML
npm run test:e2e:all-browsers  # Chromium + Firefox + WebKit — rode antes `npx playwright install firefox webkit`
```

Nenhum destes comandos precisa do `npm run dev` rodando: o `playwright.config.js` sobe o app sozinho
(`vite --mode e2e`, porta `5183` — nunca colide com o `:5173` do dev normal) e derruba ao final.

### E sem o projeto Supabase de E2E, funciona?

**Sim, para os specs `@read-only`.** Sem `.env.e2e` preenchido, o app roda em modo degradado
(`db=null`) e usa o catálogo **MOCK** (`src/data/mockCatalog.js`) — determinístico, sem rede, sem
tocar nenhum Supabase. É assim que a Onda 1 (esta) já roda hoje. Specs `@writes` (checkout real,
sessão de cliente logado, Admin) **exigem** o projeto dedicado — ver
"Pré-requisitos manuais" na auditoria; enquanto não existir, essas specs simplesmente ainda não foram
escritas (não é este README que vai fingir que funcionam).

## Configuração de ambiente (`.env.e2e`)

Copie `.env.e2e.example` (raiz do projeto) para `.env.e2e` (gitignored) quando o projeto Supabase
dedicado a E2E existir. **Nunca aponte para o Supabase de produção.** O Vite carrega esse arquivo
automaticamente por causa do `--mode e2e` — nenhum código em `src/` sabe que está sob teste.

Para os scripts Node de setup/teardown (`support/supabaseAdmin.js` e quem o usa), o mesmo
`.env.e2e` guarda `E2E_SUPABASE_SERVICE_ROLE_KEY` (nunca prefixado `VITE_`, então nunca vaza pro
bundle do browser).

## Estrutura

```
e2e/
├─ playwright.config.js   # config única (multi-browser, webServer, CI-ready)
├─ fixtures/index.js      # test.extend — importar daqui, não de '@playwright/test' direto
├─ support/               # infra Node (nunca importada por src/ nem pelos specs no browser)
│  ├─ supabaseAdmin.js    # clientes service_role/anon do projeto de E2E (env-gated)
│  ├─ storeMode.js        # força a loja OPEN/CLOSED (RPC set_store_mode, mesmo mecanismo do Admin/HB-03)
│  ├─ authSession.js      # sessão real de cliente fixture, para storageState (pula a UI de login)
│  ├─ network-stubs.js    # mocks de ViaCEP/Nominatim/Supabase-auth via page.route — usáveis hoje
│  └─ cleanup.js          # apaga, no projeto de E2E, os dados que os specs @writes criaram
├─ pages/                 # Page Object Model — 1 classe por tela/superfície
└─ tests/                 # specs, agrupados por domínio (store/cart/checkout/auth/cliente/admin)
```

## Convenções

- **Specs:** `<fluxo>.spec.js`, agrupados por pasta de domínio.
- **Page Objects:** expõem só localizadores + ações; **nenhuma asserção** vive lá — isso fica no spec.
- **Seletores, em ordem de preferência:** `getByRole`/`getByLabel` (semântica real) → `data-testid`
  (quando o elemento não é semântico o bastante) → nunca texto de cópia, posição ou classe CSS como
  estratégia permanente. Onde o componente ainda não tem seletor estável, o Page Object correspondente
  tem um comentário `TODO(REF-E2E-01 · Onda X)` apontando o que falta e em qual onda entra — não
  adicionamos `data-testid` soltos sem um spec que os use na mesma sub-fase/commit.
- **Tags:** `@read-only` (catálogo/busca/categorias/carrinho local — seguro em qualquer ambiente,
  inclusive sem `.env.e2e`) vs. `@writes` (checkout real, sessão logada, Admin — só contra o projeto
  de E2E dedicado). Ver `test.describe('...', { tag: [...] })`.
- **Sem TypeScript** — o projeto inteiro é JS puro (ESM); a suíte E2E segue o mesmo padrão.

## Multi-browser

Os 3 engines (Chromium/Firefox/WebKit) já estão configurados em `playwright.config.js`. Hoje só o
binário do Chromium está instalado (`npx playwright install chromium`) — é ele que roda por padrão em
`npm run test:e2e`. Para rodar a matriz completa: `npx playwright install firefox webkit` uma vez, e
depois `npm run test:e2e:all-browsers` (ou `--project=firefox` / `--project=webkit` isoladamente).

## Preparado para CI (GitHub Actions) — ainda não criado

`playwright.config.js` já reage a `process.env.CI` (retries, workers, `reuseExistingServer`) e o
`webServer` sobe o app sozinho — quando o workflow `.github/workflows/e2e.yml` for criado (fase
própria, fora do escopo desta Onda), não deve exigir nenhuma refatoração daqui, só o arquivo de
workflow chamando `npm ci && npx playwright install --with-deps && npm run test:e2e`.

## Onde isto para hoje (Onda 1 — infra)

Feito: config, estrutura, Page Object Model (skeletons), fixtures, helpers de `support/` (env-gated),
1ª spec (`tests/store/boot.spec.js`, prova a esteira contra o catálogo mock). **Ainda não feito**
(próximas ondas, cada uma seu commit, revisão antes de cada um — ver auditoria): specs read-only de
catálogo/busca/categorias, carrinho, e — só depois que o projeto Supabase de E2E existir — checkout,
mecânica + sessão de login, e Admin.
