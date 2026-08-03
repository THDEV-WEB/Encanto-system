# REF-ADMIN-04 — Plano de implementação por ondas

- **Status:** 📋 Planejado — **nenhuma onda iniciada**. Execução só começa após o dono aprovar o ADR
  `docs/adr/REF-ADMIN-04-redesenho-acesso-painel.md`.
- **Disciplina de execução** (mesma de todo REF anterior, ver `REF-APP-01-discipline`): 1 commit por
  onda/subfase, testes verdes antes de fechar cada onda, commits ficam **locais** (push só mediante
  pedido explícito do dono), mudanças mínimas e cirúrgicas, zero regressão na loja em nenhum momento do
  processo.
- **Pré-condição transversal:** em nenhuma onda a loja (`encanto.valionsistemas.com.br`) pode ficar sem
  acesso administrativo funcional — a engrenagem atual só é removida (Onda 4) depois que o novo caminho
  (Ondas 1–3) já estiver validado em produção.

---

## Onda 0 — Confirmações do dono (pré-requisito, decisão de produto, não técnica)

**RESOLVIDA (2026-08-03) — aprovação oficial do dono ao ADR, adotando a recomendação técnica em
todos os 3 pontos:**
- Nome do subdomínio do admin: **`admin.encanto.valionsistemas.com.br`** (proposta do D7, sem objeção).
- Terceiro projeto Vercel: **confirmado** — listado explicitamente como objetivo na aprovação.
- Easter-egg de 5 cliques + hash `#admin-encanto`: **removidos 100%**, sem fallback de emergência na
  loja (recomendação técnica original, adotada sem ressalva).

**Critério de saída:** atendido — as 3 respostas acima registradas.

---

## Onda 1 — Novo ponto de entrada de build (admin isolado do bundle da loja)

**✅ CONCLUÍDA (2026-08-03).**

- `admin.html` (raiz do repo) criado — monta `AdminApp.jsx`, que renderiza `AdminLogin`/`AdminPanel`
  via `useAdminSession` reaproveitado sem alteração, sem `StoreApp`, sem `AuthProvider` do cliente, sem
  `useDownloadPage`/`useCapacitorBackButton` (hooks exclusivos da loja/Capacitor).
- `src/admin-main.jsx` (novo) — ponto de montagem do bundle admin, mesmo padrão de `src/main.jsx`.
- `src/RootBoundary.jsx` (novo) — Error Boundary extraído de `main.jsx` (era inline), agora
  compartilhado pelos dois entry points sem duplicação de código.
- `src/AdminApp.jsx` (novo) — raiz do admin: único comportamento adaptado é `onExit` ("← Ver loja"),
  que deixa de ser troca de `mode` interno (não existe `StoreApp` neste bundle) e passa a ser
  navegação real para `https://encanto.valionsistemas.com.br/encanto/`. Login, `is_admin()`, sessão e
  logout são o mesmo código de sempre, zero alteração de comportamento.
- `vite.config.js`: 3º valor de `mode` (`admin`), mesmo mecanismo de gate único já usado para
  `capacitor` — `base:'/'`, `outDir:'dist/admin'`, `rollupOptions.input:'admin.html'` (só neste modo;
  web/capacitor continuam usando o `index.html` default do Vite, agora que `admin.html` também existe
  no repo). PWA plugin instanciado uma 2ª vez para o admin, **desligado nesta onda**
  (`disable:true`, `filename:'sw-admin.js'`) — scaffolding para a Onda 2 ligar.
- `package.json`: scripts `build:admin`/`preview:admin` (espelham `build:capacitor`/`preview:capacitor`).
- Manifest/SW da loja (`public/manifest.json`, `sw.js`) **intocados** nesta onda, como previsto.

**Verificação real:**
- `npm run build` (loja): sucesso, 613 módulos (+1 vs. baseline — o novo `RootBoundary.jsx` extraído),
  bundle 615.12 kB / 174.58 kB gzip (baseline era 614.13 kB — variação desprezível, mesma ordem de
  grandeza). Estrutura de saída (`dist/encanto/`) inalterada.
- `npm run build:admin`: sucesso, **515 módulos** — grafo de módulos genuinamente menor que o da loja,
  confirmando separação real de bundle (não é só um `if` escondendo UI: `AdminApp` nunca importa
  `StoreApp`/`AuthProvider` do cliente). Saída: `dist/admin/admin.html` + `admin-*.js` (484 kB / 136 kB
  gzip) + CSS compartilhado (hash **idêntico** ao da loja — confirma reaproveitamento total do design
  system, zero duplicação de estilo).
- `npm run test:domain`: **verde, sem regressão** (suite completa, mesmo resultado de antes da
  extração do `RootBoundary`).
- `vite preview --mode admin`: `GET /admin.html` → HTTP 200 com os asset paths absolutos corretos
  (`/assets/admin-*.js`). `GET /` → 404 local, **esperado** (Vite preview não sabe servir
  `admin.html` como raiz — isso é responsabilidade do rewrite `/ → /admin.html` que o projeto Vercel
  do admin vai precisar, ver Onda 3).

**Achado técnico registrado para a Onda 3:** o novo projeto Vercel do admin, se apontado para a
**mesma raiz do repositório**, vai ler o **mesmo `vercel.json`** que já existe (redirect `/`→`/encanto`,
rewrite de `/encanto/download`) — sem tratamento, essas regras da loja vazariam para o domínio do
admin. Resolvido preparando (Onda 3) condições `has:[{"type":"host","value":"..."}]` no `vercel.json`
compartilhado, escopando as regras da loja aos domínios dela e adicionando a regra própria do admin
(`/` → `/admin.html`, condicionada ao host do admin) — sem precisar de Root Directory separado nem de
monorepo/workspace.

**1 commit** (`admin-04`).

## Onda 2 — Manifest e Service Worker dedicados do Admin

**✅ CONCLUÍDA (2026-08-03).**

- `public/manifest-admin.json` (novo): `name`/`short_name`="Encanto Admin", `id`/`start_url`/`scope`="/"
  (raiz do domínio do admin — nunca `/encanto/`, sem risco de colisão de scope com a loja mesmo que um
  dia acabem no mesmo navegador/perfil). Ícones **reaproveitados dos arquivos já existentes**
  (`icon-valion-192/512-v2.png`) — nenhum ativo visual distinto foi fornecido ainda; fica registrado
  como pendência de design (não bloqueia a arquitetura, só a diferenciação visual do ícone na tela
  inicial — nome/identidade de app já são distintos independentemente disso).
- `admin.html`: `<link rel="manifest" href="/manifest-admin.json">` + favicons/apple-touch-icon
  (mesmos arquivos da loja) + meta tags PWA (`apple-mobile-web-app-*`, `theme-color`), espelhando
  `index.html`.
- `vite.config.js`: 2ª instância do plugin `vite-plugin-pwa` ligada para o modo `admin`
  (`disable:false`, `filename:'sw-admin.js'`, `navigateFallback:'admin.html'`) — mesma config Workbox
  da loja (sem `runtimeCaching`, `registerType:'prompt'`, zero mudança de estratégia).
- **Verificação real:** `npm run build:admin` gera `dist/admin/manifest-admin.json`,
  `dist/admin/sw-admin.js` + `workbox-*.js`, 17 entradas de precache (1131 KiB); ícones/favicons
  presentes (copiados automaticamente de `public/`, mesmo mecanismo que já serve a loja).
  `npm run build` (loja): saída **byte a byte idêntica** à da Onda 1 (mesmo hash `index-DXx8L6EF.js`,
  615.12 kB). `npm run test:domain`: verde, sem regressão.
- **Observação não-bloqueante:** por `public/` ser copiado inteiro em qualquer modo de build, o output
  do admin também carrega arquivos exclusivos da loja (`manifest.json`, `header-bg.jpg`,
  `downloads/Encanto.apk`, etc.) — nenhum deles é referenciado pelo `admin.html`, e nenhum é
  informação nova (já são públicos hoje no domínio da loja); só ocupam alguns KB extras no output do
  admin sem função nenhuma. Não justificou reestruturar `public/` em subpastas por bundle nesta REF.
- Instalação lado a lado (ícone "Encanto" vs. "Encanto Admin" na tela inicial/gaveta de apps) depende
  de dispositivo real — fica para a QA manual da Onda 6.
- **1 commit** (`admin-04`).

## Onda 3 — Terceiro projeto Vercel + domínio + Supabase Auth

**🟡 PARCIAL (2026-08-03) — parte de código pronta e commitada; parte de infraestrutura BLOQUEADA por
falta de credencial (Vercel/DNS/Supabase), conforme previsto na própria autorização do dono
("bloqueio externo... Vercel... Supabase" é motivo explícito de parada).** Este ambiente de agente não
tem CLI da Vercel autenticado, nem token de Management API do Supabase, nem acesso ao painel de DNS
(Registro.br) — confirmado por checagem direta antes de começar (nenhuma credencial nas variáveis de
ambiente, `vercel` não instalado). Nenhuma dessas ações pode ser feita sem o dono.

**✅ Feito (código, já commitado):**
- `vercel.json` ajustado com condições `has:[{"type":"host","value":"..."}]` nas 3 regras da loja
  (redirect `/`→`/encanto`, rewrite de `/encanto/download`, header do `.apk`), escopadas aos 2 domínios
  de produção já conhecidos (`encanto.valionsistemas.com.br`, `encanto-system.vercel.app`) — preserva
  100% do comportamento atual para esses domínios (e para qualquer outro host não listado, ex. uma
  eventual preview deployment, que simplesmente deixa de receber esse redirect específico — mudança
  cosmética, não afeta usuário real, que só acessa pelos 2 domínios de produção).
- Nova regra de rewrite `/` → `/admin.html`, escopada por `has:host` só para
  `admin.encanto.valionsistemas.com.br` — resolve o achado técnico da Onda 1 (o build do admin gera
  fisicamente `admin.html`, não `index.html`) sem precisar de Root Directory separado nem de
  monorepo/workspace: os dois projetos Vercel podem apontar para a raiz do MESMO repositório e ler o
  MESMO `vercel.json`, cada regra só disparando para o host a que pertence.
- JSON validado (`node -e "JSON.parse(...)"`, sem erro de sintaxe).

**⏸️ Bloqueado — ações que só o dono pode fazer (nenhuma tem alternativa técnica):**

1. **Criar o 3º projeto Vercel** — Dashboard Vercel → "Add New Project" → importar o mesmo repositório
   `THDEV-WEB/Encanto-system` (o mesmo GitHub repo já usado pelo projeto `encanto-system` — Vercel
   permite múltiplos projetos apontando pro mesmo repo). Nome sugerido: `encanto-admin`.
2. **Configurar Build & Development Settings** desse novo projeto (Project Settings → Build & Development
   Settings → ligar "Override"):
   - Build Command: `npm run build:admin`
   - Output Directory: `dist/admin`
   - Install Command: padrão (`npm install`, mesmas dependências do projeto principal).
3. **Copiar as Environment Variables** do projeto `encanto-system` para o novo projeto (Project Settings
   → Environment Variables): no mínimo `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (sem elas o build do
   admin sobe em modo degradado, sem falar com o Supabase real). Variáveis do Sentry
   (`SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT`) são opcionais, copiar só se quiser rastreamento de
   erro também no admin.
4. **Anexar o domínio** `admin.encanto.valionsistemas.com.br` a esse novo projeto (Project Settings →
   Domains → Add) — a Vercel mostra um registro CNAME (algo como `cname.vercel-dns.com`) para cadastrar.
5. **Criar o registro CNAME** na zona DNS de `valionsistemas.com.br` (Registro.br, "modo avançado", mesmo
   painel já usado em `REF-BRAND-01`) apontando `admin.encanto` para o destino que a Vercel indicou no
   passo 4. Propagação + certificado SSL automático da Vercel costumam levar minutos.
6. **Supabase Auth `uri_allow_list`** — **achado ao revisar o fluxo de login do admin nesta onda: o D6 do
   ADR pode estar sendo excessivamente cauteloso aqui.** `AdminLogin.jsx` usa
   `db.auth.signInWithPassword` com `detectSessionInUrl:false` (ver `lib/supabase.js`) — **não há redirect
   nenhum no login do admin** (diferente do OAuth Google do cliente, que é o motivo real de
   `uri_allow_list` existir). Ou seja, o domínio do admin **provavelmente não precisa** entrar nessa
   lista para o login funcionar. Registrado como item a **confirmar empiricamente assim que o domínio
   estiver no ar** (um teste de login real resolve a dúvida em segundos) — não uma ação obrigatória a
   priori como o texto original do ADR sugeria.

**Depois que os passos 1–5 acima estiverem feitos, avise — a verificação técnica (deploy ao vivo serve o
build do admin por conteúdo, login + `is_admin()` reais, loja confirmada inalterada) e o restante das
ondas seguem automaticamente, sem precisar reconfirmar autorização** (mesma regra de execução contínua
desta aprovação).

**1 commit** (`vercel.json` + esta atualização de documentação — a criação do projeto/domínio em si é
ação de infraestrutura, fora do repositório).

## Onda 4 — Remoção da engrenagem, do easter-egg e do hash de acesso da loja

- Remover `onAdmin`/botão ⚙️ (`StoreApp.jsx:234-236`), listener de 5 cliques na logo
  (`StoreApp.jsx:171-186`), listener de `#admin-encanto` (`useAdminSession.js:44-50`).
- Corrigir o e-mail hardcoded em `AdminLogin.jsx:8` (achado de higiene do §2 do ADR) — troca do
  `useState('as992203620@gmail.com')` por estado vazio, sem qualquer outra mudança no formulário.
- **Só executa depois que a Onda 3 estiver validada em produção** (pré-condição transversal do topo
  deste documento).
- **Verificação:** `test:domain` completo verde; inspeção manual confirmando zero referência a admin no
  bundle público da loja (nem no HTML renderizado, nem nos assets JS/CSS gerados).
- **1 commit.**

## Onda 5 — Adaptação da suíte E2E

- Specs que hoje navegam via `data-testid="header-admin-btn"` passam a usar um `baseURL` próprio
  apontando para o domínio/build do admin (segunda config Playwright, ou segundo `project` dentro do
  `playwright.config.js` existente — a decidir na implementação, sem introduzir ferramenta nova).
- **Verificação:** `test:e2e` completo verde (loja + admin), mesma cobertura numérica de antes (nenhum
  spec perdido, só redirecionado para o novo caminho).
- **1 commit.**

## Onda 6 — QA manual do dono e encerramento

- Checklist de dispositivo real: instalação lado a lado das duas PWAs (Loja + Admin) em Android Chrome,
  Desktop Chrome/Edge e iOS Safari, confirmando ícone/nome distintos e abertura direta em cada uma.
- Smoke test de sessão (login, `is_admin()`, logout, reconexão) no novo domínio.
- Confirmação de que a loja pública não expõe mais nenhuma pista (visual ou de código) do painel.
- Documentação de fechamento (`docs/ref/REF-ADMIN-04-progress.md`, seguindo o padrão de todo REF
  anterior) e atualização do índice `docs/adr/README.md`.
- **Encerramento do REF.**

---

## Resumo de esforço

| Onda | Esforço relativo | Impacto em produção |
|---|---|---|
| 0 | Decisão do dono, não técnica | Nenhum |
| 1 | Baixo | Nenhum (build novo, não publicado) |
| 2 | Baixo | Nenhum (build novo, não publicado) |
| 3 | Médio | **Primeiro impacto real** — novo domínio ao vivo |
| 4 | Baixo | Sim — remove a engrenagem da loja em produção |
| 5 | Médio | Nenhum (só suíte de testes) |
| 6 | Baixo | Nenhum (validação/documentação) |

Nenhuma onda começa sem a aprovação do ADR `REF-ADMIN-04-redesenho-acesso-painel.md`.
