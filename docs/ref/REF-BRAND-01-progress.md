# REF-BRAND-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui — não
repetir auditoria/implementação já concluída abaixo.

**Contexto:** domínio `valionsistemas.com.br` registrado. Objetivo: landing institucional nova na
raiz + este sistema (Encanto) em `/encanto`. Auditoria completa + ADR em
`docs/adr/REF-BRAND-01-dominio-institucional.md`.

## Estado atual

✅ Onda 1 (landing) e Onda 2 (sub-path neste repo) CONCLUÍDAS, gates 100% verdes. ⏳ Onda 4
(Vercel/DNS/Supabase) depende de ações do dono fora deste repo. Push deste repo aguardando
aprovação final do dono (produção viva).

## Onda 1 — Landing institucional (repo novo `valion-sistemas-site`)

Status: ✅ CONCLUÍDA localmente. Vite + React + React Router em
`C:\Projetos\Valion\valion-sistemas-site`. Home com copy institucional placeholder + destaque ao
Encanto System; stubs "em breve" para `/portfolio`, `/servicos`, `/contato`, `/blog`
(lazy-loaded). `index.html` com meta tags (title/description/OG/canonical), favicon próprio,
`robots.txt` (`Disallow: /encanto`) + `sitemap.xml`. `vercel.json` com o rewrite de `/encanto/*`
para `https://encanto-system.vercel.app/encanto/*`, antes do fallback SPA. Build + lint + smoke
test (`vite preview`) verdes. Commit local `bf9cf4b`. **Push pendente** — aguardando repo GitHub
vazio (`THDEV-WEB/valion-sistemas-site` sugerido) do dono.

## Onda 2 — Sub-path `/encanto` neste repo (`encanto-react`)

Status: ✅ CONCLUÍDA. Arquivos alterados: `vite.config.js` (`base: '/encanto/'` +
`outDir: 'dist/encanto'` + glob do Sentry sourcemap ajustado), `src/lib/supabase.js` (`LOGO` via
`BASE_URL`), `src/index.css` + `src/pages/StoreApp.jsx` (`--header-bg-url` via `style` inline, CSS
não aceita `import.meta.env`), `src/services/AuthService.js` (`redirectTo` do OAuth Google inclui
`BASE_URL`), `vercel.json` novo (`outputDirectory: 'dist'` + redirect `/`→`/encanto`),
`e2e/playwright.config.js` (sem mudança — baseURL segue raiz do server local), 3 arquivos E2E com
`goto('/...')` ajustados (`e2e/pages/StorePage.js`, `e2e/pages/AdminLoginPage.js`,
`e2e/tests/store/boot.spec.js`). ADR completo em `docs/adr/REF-BRAND-01-dominio-institucional.md`.

## VALIDAÇÃO (local, pré-push)

- ✅ `npm run build`: `dist/encanto/index.html` referencia `/encanto/assets/...`; bundle resolve
  `/encanto/logo.jpg` e `/encanto/header-bg.jpg` corretamente (verificado no output minificado).
- ✅ `npm run test:domain`: verde (mesma suíte; nenhum teste quebrado pela mudança).
- ✅ `npm run test:e2e` (Chromium, suíte completa, contra o projeto Supabase dedicado de E2E):
  **113 passed**, servindo sob `/encanto/` de ponta a ponta.
- ✅ Smoke test manual (`vite preview`): `/encanto/`, assets, `logo.jpg`, `header-bg.jpg` — 200;
  `/` — redirect.
- ✅ Diff restrito exatamente aos arquivos do plano — zero scope creep.

## Pendências (fora do controle deste ambiente)

1. Dono cria repo GitHub vazio para a landing e informa a URL → push do commit local `bf9cf4b`.
2. Dono aprova o diff deste repo (produção viva) → push do commit desta onda.
3. Dono cria o projeto Vercel `valion-sistemas-site`, conecta o domínio
   `valionsistemas.com.br` (+`www`) **nesse** projeto (não no `encanto-system`), configura DNS no
   registrador com os valores mostrados pela Vercel.
4. Dono atualiza a allow-list de Redirect URLs do Supabase Auth (Dashboard → Authentication → URL
   Configuration) para incluir `https://valionsistemas.com.br/encanto/**` — sem isso o login Google
   em produção quebra com redirect não autorizado.
5. Pós-deploy: smoke test ao vivo (raiz = landing, `/encanto` = Encanto, assets, login Google).
