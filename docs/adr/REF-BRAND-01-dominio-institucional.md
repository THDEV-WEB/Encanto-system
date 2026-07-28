# ADR REF-BRAND-01 — Domínio institucional Valion Sistemas + Encanto em `/encanto`

- **Status:** ✅ Implementada no código deste repo (Onda 2), gates 100% verdes localmente
  (`npm run build`, `npm run test:domain`, `npm run test:e2e` completo sob `/encanto`).
  **Pendente do dono:** criar/configurar o projeto Vercel da landing nova, adicionar o domínio
  `valionsistemas.com.br` (na landing, não no `encanto-system`), DNS no registrador, e atualizar
  a allow-list de Redirect URLs do Supabase Auth. Ver relatório final da sessão para o passo a
  passo.
- **Escopo:** o domínio institucional `valionsistemas.com.br` foi registrado. A raiz do domínio
  deve abrir uma landing institucional nova (repo separado, `valion-sistemas-site`);
  `valionsistemas.com.br/encanto` deve abrir este sistema (hoje servido na raiz de
  `encanto-system.vercel.app`). A arquitetura precisa suportar crescimento futuro
  (`/portfolio`, `/servicos`, `/contato`, `/blog`) sem acoplar o cadence de deploy da landing ao
  deste sistema, que é produção viva (pedidos/fidelidade reais).

---

## 1. Contexto e auditoria

Auditoria completa do repo (routing, Vite `base`, assets absolutos, `index.html`, manifest/PWA,
links internos, `vercel.json`, E2E) antes de qualquer mudança. Achados que definiram a solução:

- **Este app não usa React Router nem roteamento por URL algum.** `react-router-dom` não é
  dependência; navegação interna (`home`/`checkout`/`success`, admin) é 100% estado React
  (`src/pages/StoreApp.jsx`, `src/hooks/useAdminSession.js`). Isso elimina o maior risco típico de
  migração para sub-path — não existe tabela de rotas para remapear.
- `vite.config.js` não definia `base` (default `/`).
- Dois caminhos absolutos hardcoded que a opção `base` do Vite **não reescreve** (Vite só reescreve
  imports ES e o que ele mesmo parseia no `index.html`; string literal em JS e `url()` absoluto em
  CSS ficam como estão): `LOGO = '/logo.jpg'` (`src/lib/supabase.js`) e
  `url('/header-bg.jpg')` (`src/index.css`, regra `.header`).
- `vercel.json` não existia neste repo — nada a preservar.
- OAuth Google usava `redirectTo: window.location.origin` (`src/services/AuthService.js`) — sem o
  sub-path, o retorno do login cairia na raiz do domínio (a landing), não neste app.
- Sem manifest/PWA, sem `robots.txt`/`sitemap.xml`/favicon em lugar nenhum — nada a migrar.
- E2E (Playwright): só 3 arquivos usavam `page.goto('/...')` absoluto
  (`e2e/pages/StorePage.js`, `e2e/pages/AdminLoginPage.js`, `e2e/tests/store/boot.spec.js`) — a
  maioria dos specs passa pelos Page Objects, então o ajuste ficou pequeno e centralizado.
- Este repo é independente (`github.com/THDEV-WEB/Encanto-system`, projeto Vercel próprio
  `encanto-system`, sem domínio custom hoje — só `.vercel.app`).

## 2. Decisão — dois projetos Vercel independentes + rewrite/proxy de borda

Em vez de um monorepo com build combinado (landing + Encanto no mesmo projeto Vercel), a solução
usa **dois projetos Vercel totalmente independentes**, unidos só na camada de roteamento HTTP:

1. **`valion-sistemas-site`** (repo novo): dono do domínio `valionsistemas.com.br`. Seu
   `vercel.json` tem um `rewrite` — `/encanto/:path*` → `https://encanto-system.vercel.app/encanto/:path*`
   — que faz proxy (edge-to-edge, dentro da rede da própria Vercel; padrão documentado
   oficialmente para "rewrite para URL externa", não é hack) para o deployment deste repo, **antes**
   do fallback SPA `/(.*)`→`/index.html` da própria landing. Confirmado nos docs da Vercel: arquivos
   estáticos (`robots.txt`, `sitemap.xml`, favicon) têm precedência sobre `rewrites` automaticamente
   — não há risco de o catch-all engolir esses arquivos.
2. **`encanto-system`** (este repo, local/CI/histórico inalterados):
   - `vite.config.js`: `base: '/encanto/'` + `build.outDir: 'dist/encanto'` — faz a **saída física**
     do build bater exatamente com a URL (`dist/encanto/index.html` serve em `/encanto/`,
     `dist/encanto/assets/*` em `/encanto/assets/*`), sem precisar de rewrite nenhum dentro deste
     próprio projeto Vercel.
   - `LOGO` e `--header-bg-url` passam a usar `import.meta.env.BASE_URL` (a CSS não aceita essa
     sintaxe diretamente — a var CSS é setada via `style` inline no elemento `.header`,
     `src/pages/StoreApp.jsx`, mantendo o resto da regra `.header` intocado em `index.css`).
   - `vercel.json` novo: `outputDirectory: 'dist'` + redirect cosmético `/` → `/encanto` (evita 404
     na raiz do `.vercel.app`, que continua existindo como ambiente de staging/debug).
   - `AuthService.signInWithGoogle`: `redirectTo` passa a ser `window.location.origin + BASE_URL`.
   - Sentry (`sentryVitePlugin.sourcemaps.filesToDeleteAfterUpload`): glob atualizado de
     `dist/**/*.map` para `dist/encanto/**/*.map` — sem isso, o outDir novo faria os `.map` NÃO
     serem apagados após o upload, vazando publicamente o source map (regressão de segurança
     silenciosa que só apareceria em produção).

### Por que não monorepo com build único

Acoplaria o cadence de deploy de um site institucional (sem tráfego real ainda) ao pipeline de um
sistema live com pedidos reais — exigiria mexer na localização/CI/histórico deste repo por zero
ganho técnico. Dois projetos independentes preservam o CI, o deploy e o domínio de staging deste
repo exatamente como estão; a landing evolui sozinha, sem nunca poder quebrar o Encanto.

### Por que não subdomínio (`encanto.valionsistemas.com.br`)

Seria zero-touch neste repo (só um CNAME), mas o dono pediu explicitamente o caminho `/encanto` sob
o mesmo domínio — registrado aqui como alternativa mais simples, rejeitada por não atender o
requisito.

### Por que não `base: './'` (relativo) no Vite

Evitaria hardcodar `/encanto/` no build (o mesmo artefato serviria em qualquer sub-path), mas não é
o padrão oficialmente documentado pela Vite para este cenário — a doc de "deploy em sub-path"
recomenda exatamente `base: '/caminho/'` absoluto — e há histórico de edge cases com HMR em dev
server com base relativa. `base` absoluto é o caminho chato-e-correto, com o efeito colateral aceito
de que dev/preview/E2E locais agora servem sob `/encanto/` também (documentado no relatório final).

## 3. Consequência aceita — dev local sob `/encanto/`

`npm run dev`/`npm run preview`/os testes E2E locais agora servem a aplicação em
`http://localhost:5173/encanto/` (não mais na raiz) — efeito direto de `base: '/encanto/'`, não um
bug. `playwright.config.js` não precisou de mudança (baseURL continua a raiz do servidor local); os
3 arquivos com `goto('/...')` foram atualizados para apontar para `/encanto/...` explicitamente, em
vez de depender de composição de URL (um `/` absoluto em `page.goto()` substitui todo o path da
`baseURL`, pela resolução de URL do WHATWG — não seria reescrito sozinho).

## 4. Robots/sitemap — domínio tem um dono só

`robots.txt`/`sitemap.xml` só podem existir uma vez por domínio (raiz) — moram no projeto da
landing, não neste repo. `robots.txt` da landing inclui `Disallow: /encanto` (é um app de pedidos,
não conteúdo de marketing) — ajustável pelo dono a qualquer momento sem tocar neste repo.

## 5. Testes e validação

- `npm run build`: `dist/encanto/index.html` referencia `/encanto/assets/...` corretamente
  (verificado no HTML gerado); bundle contém `/encanto/logo.jpg` e `/encanto/header-bg.jpg`
  resolvidos em tempo de build (`import.meta.env.BASE_URL` estático).
- `npm run test:domain`: verde (mesma suíte de sempre; `LOGO` em contexto Node puro — sem
  `import.meta.env` — continua resolvendo para `/logo.jpg`, comportamento idêntico ao anterior).
- `npm run test:e2e` (suíte completa, Chromium, contra o projeto Supabase dedicado de E2E): **113
  passed**, servindo a aplicação sob `/encanto/` de ponta a ponta (Page Objects atualizados).
- Smoke test manual via `vite preview`: `/encanto/`, `/encanto/assets/*.js`, `/encanto/logo.jpg`,
  `/encanto/header-bg.jpg` respondem 200; `/` responde redirect (comportamento nativo do Vite
  preview quando `base != '/'`, reforçado em produção pelo redirect explícito do `vercel.json`).

## 6. Pendências (fora deste repo)

- Criar o projeto Vercel `valion-sistemas-site` a partir do repo novo.
- Adicionar `valionsistemas.com.br` (+ `www`) como domínio **desse** projeto (não do
  `encanto-system`) e configurar os registros DNS mostrados pela Vercel no registrador do domínio.
- Atualizar a allow-list de Redirect URLs do Supabase Auth (Dashboard → Authentication → URL
  Configuration) para incluir `https://valionsistemas.com.br/encanto/**` — sem isso, o login Google
  em produção falha com redirect não autorizado.
