# REF-OBS-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida (limite, queda, sessão encerrada), retomar
EXCLUSIVAMENTE a partir daqui — não repetir o que já está marcado como concluído abaixo.

**Regra do dono para esta REF:** trabalhar de forma autônoma, todas as ondas, sem interromper para
pedir confirmação. **NÃO commitar** até apresentar o relatório final para aprovação.

## Estado atual

🔄 Em andamento — Ondas 1 e 2 implementadas, Onda 3 (validação + relatório) em curso.

## Decisões de arquitetura (antes de codar)

- **Sem projeto Sentry ainda** (dono não forneceu DSN nem token): tudo gated pelo MESMO padrão já usado
  pelos secrets de E2E (REF-CI-01) e pelo modo degradado de `lib/supabase.js` — sem `VITE_SENTRY_DSN`,
  Sentry nunca inicializa (zero custo, zero rede, zero mudança de comportamento); sem
  `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` no build, o upload de source maps nem entra no pipeline do Vite.
  O código fica 100% pronto; liga sozinho no momento em que o dono criar o projeto e configurar as envs
  (mesma mecânica que já funcionou bem para os secrets de E2E).
- **Captura global + assíncrona**: `Sentry.init()` já instala sozinho os handlers de
  `window.onerror`/`unhandledrejection` e breadcrumbs de console/fetch/click/navegação — não reimplementa
  nada disso (o app já tem um coletor forense PRÓPRIO e TEMPORÁRIO em `index.html`, REF-BOOT-02, que
  também escuta esses eventos; múltiplos listeners no mesmo evento são normais e não conflitam — REF-BOOT-02
  não é tocado nem removido, é uma frente separada e ainda pendente do dono).
- **Error Boundary**: preserva as DUAS boundaries existentes (`main.jsx` RootBoundary,
  `ProductModalBoundary.jsx`) — só adiciona `capturarErroReact()` dentro do `componentDidCatch` de cada
  uma (a segunda nem tinha `componentDidCatch`; hoje um erro ali é 100% silencioso). Nenhuma UI de
  fallback nova, nenhuma substituição por `Sentry.ErrorBoundary`.
- **Release**: `VERCEL_GIT_COMMIT_SHA` (injetado automaticamente pela Vercel no build) via `define` no
  `vite.config.js` — mesmo valor usado no `Sentry.init` do bundle E no upload de source maps (as duas
  pontas têm que casar). Fallback `'dev'` local/CI sem Vercel.
- **Ambiente**: `import.meta.env.MODE` (Vite nativo — 'development'/'production'/'e2e'), não um boolean
  próprio. Em modo `e2e`, `VITE_SENTRY_DSN` nunca está setado (não existe em `.env.e2e`) → Sentry inerte,
  suíte E2E não gera ruído no Sentry mesmo se o dono configurar o DSN futuramente sem tocar em `.env.e2e`.
- **Contexto de usuário**: só `id` + `role` — NUNCA telefone/nome/e-mail do CLIENTE (PII real). Para o
  Admin (equipe pequena, interna), `id` + `role:'admin'` também, mesma cautela.
- **Breadcrumbs**: a maioria vem de graça (fetch/console/click do SDK). Só adiciona um punhado manual em
  pontos de negócio de alto valor para debugging (checkout: sucesso/falha; admin: login sucesso/falha) —
  não instrumenta cada `try/catch` do app (a maioria já é falha ESPERADA e tratada, não teria valor
  virar evento no Sentry).

## Onda 1 — Núcleo do Sentry (captura global, Error Boundaries, source maps, release/ambiente)

Status: ✅ CONCLUÍDA.
- `npm install @sentry/react @sentry/vite-plugin` (10.68.0 / 5.4.0 — versões exatas, `--save-exact`).
  `@sentry/vite-plugin` em `devDependencies` (ferramenta de build, não runtime do navegador).
- `vite.config.js`: `RELEASE` (git sha via Vercel/GitHub Actions, fallback `dev`) usado em `define`
  (`__APP_RELEASE__`, consumido pelo bundle) e no `sentryVitePlugin` (só entra no array de plugins se
  `SENTRY_AUTH_TOKEN`+`SENTRY_ORG`+`SENTRY_PROJECT` existirem). `build.sourcemap`: `'hidden'` SÓ quando
  há credencial pronta pra subir E apagar do dist depois — sem isso, fica `false` (nunca gera .map público
  sem ninguém pra consumi-lo).
- `src/lib/sentry.js` (novo): mesmo padrão de `lib/supabase.js` — `sentryAtivo` (bool), `Sentry.init`
  condicional, e 4 helpers no-op-seguros: `capturarErroReact`, `marcarArea`, `setUsuario`/`limparUsuario`,
  `registrarBreadcrumb`.
- `src/main.jsx`: `RootBoundary.componentDidCatch` chama `capturarErroReact(err, info)` (além do que já
  fazia — console.error + checkpoint do REF-BOOT-02, preservados).
- `src/components/ProductModal/ProductModalBoundary.jsx`: ganhou `componentDidCatch` (não tinha nenhum)
  chamando `capturarErroReact`.
- `.env.example`: documenta `VITE_SENTRY_DSN` (opcional) e `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` (opcionais,
  só build, nunca prefixo VITE_).

## Onda 2 — Contexto de usuário, tags de área, breadcrumbs de negócio

Status: ✅ CONCLUÍDA.
- `src/providers/AuthProvider.jsx`: `carregarCustomer` chama `setUsuario(cust.id, {role:'cliente'})` (ou
  `limparUsuario()` se não há sessão) — cobre login/logout/expiração via o mesmo fluxo que já existia
  (`onAuthStateChange` → `carregarCustomer`), sem hook novo.
- `src/hooks/useAdminSession.js`: `limparUsuario()` no `onAuthStateChange` sem sessão; novo `useEffect`
  sincroniza `marcarArea('admin'|'loja')` + `setUsuario(admin.id,{role:'admin'})` com o `mode` real
  (única fonte que já gate a UI loja/admin em `App.jsx` — nenhuma duplicação de estado).
- `src/components/checkout/CheckoutPage.jsx`: `registrarBreadcrumb` em sucesso (`orderId`, contagem de
  itens, retirada/entrega) e falha (`DS.savePedido` retornou null) do submit.
- `src/components/admin/AdminLogin.jsx`: `registrarBreadcrumb` em sucesso/falha/sessão-ausente do login.

## Onda 3 — Validação + documentação + relatório final

Status: ✅ CONCLUÍDA.
- `npm run build` sem `VITE_SENTRY_DSN` (estado atual do `.env`): bundle **577.56 kB** (antes desta REF:
  577.32 kB — +0,24 kB). Confirma que o replace estático do Vite (`import.meta.env.VITE_SENTRY_DSN` →
  `""` em build) deixa `sentryAtivo` como constante `false`, e o minificador elimina quase todo o SDK do
  Sentry por dead-code — custo real fica perto de zero enquanto o dono não configurar nada.
- `npm run build` COM `VITE_SENTRY_DSN` (fake, só formato válido, testado e revertido): bundle **667.02
  kB** (+89,46 kB / +29,83 kB gzip) — confirma que o SDK entra de verdade quando configurado. Smoke real
  em Chromium (via Playwright) na build servida (`vite preview`): título carrega, zero `pageerror`, só um
  `console.error` de rede esperado (o DSN é fake, aponta pra um projeto Sentry que não existe — o SDK
  tentou mandar o evento, a Sentry recusou 400; comportamento correto e não-fatal).
- **Achado real durante a validação (2 rodadas)**: `tests/render.smoke.mjs` (Node puro via esbuild, SEM
  Vite — `import.meta.env` não existe nesse ambiente) quebrou ao importar `ProductModalBoundary.jsx`, que
  agora importa `lib/sentry.js`. 1ª tentativa: `import.meta.env?.X` (optional chaining) — resolveu o
  crash, MAS reintroduziu um problema pior, só percebido ao remedir o bundle: o Vite só substitui
  `import.meta.env.X` (acesso DIRETO) por um literal em build; com `?.` a checagem vira uma leitura de
  objeto em runtime, e o minificador para de enxergar `sentryAtivo` como constante `false` — o SDK
  inteiro do Sentry deixava de ser eliminado por dead-code MESMO sem nenhum DSN configurado (bundle
  voltava a 667 kB, e não 577,56 kB). Revertido. **Fix definitivo**: mantido o acesso direto
  (`import.meta.env.X`, sem `?.`) em `lib/sentry.js` — preserva a eliminação no Vite — e o shim foi
  movido para a camada certa, `tests/_render-loader.mjs` (infra de teste, não código do projeto): agora
  transforma qualquer `.js`/`.jsx` de `src/` (fora de `node_modules`) via esbuild com
  `define: {'import.meta.env':'{}'}`, deixando `import.meta.env.QUALQUER_COISA` resolver pra `undefined`
  sem lançar — corrige a causa raiz (nenhum módulo de `src/` tem `import.meta.env` real nesse harness) em
  vez de remendar cada consumidor. Confirmado que `lib/supabase.js` já tinha essa MESMA fragilidade desde
  a sua criação (commit `8703394`, 2026-06-30 — quase um mês antes desta REF) e que
  `tests/dataservice.micro.mjs` já a tolerava como "skip-clean" documentado desde 2026-07-06 — ambos
  PRÉ-EXISTENTES, não introduzidos por esta REF.
- `npm run test:domain`: **26/26 verdes** (inclui `test:render` 14/14 folhas e `test:deps` — nenhuma
  camada nova viola D1/D2/D3, `lib/sentry.js` não importa nem é importado por `pricing`/`addons`).
- `npm run test:e2e` (suíte completa, Playwright): **104/104 verdes**, sem nenhum flake — zero regressão
  nos fluxos de checkout/login/fidelidade tocados pelos breadcrumbs/contexto de usuário novos.
- Revisão adversarial própria (linha a linha de cada arquivo tocado): confirmado que `AuthProvider`
  (cliente) e `useAdminSession` (admin) nunca ficam montados ao mesmo tempo (`App.jsx` só renderiza UM
  dos dois por vez) — sem risco de um contexto de usuário sobrescrever o outro por corrida.
- `npm audit`: 2 vulnerabilidades PRÉ-EXISTENTES (esbuild/vite, dev-server only, requerem upgrade
  MAJOR do Vite — fora de escopo desta REF) permanecem; a de `postcss` (não-breaking) foi corrigida de
  passagem via `npm audit fix`.

## ESTADO FINAL

✅ REF-OBS-01 implementada e validada de ponta a ponta. Aguardando aprovação do dono para commit (nenhum
commit foi feito — regra desta REF).
