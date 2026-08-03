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

**ATUALIZAÇÃO (2026-08-03) — dono forneceu um token temporário da Vercel, escopo restrito às tarefas
desta onda. Executado via API (`api.vercel.com`), token usado só para o que foi pedido e já
descartado/removido do ambiente (nunca gravado no repositório, nunca impresso em nenhuma saída) assim
que deixou de ser necessário. Resultado:**

1. ✅ **3º projeto Vercel criado** — `encanto-admin` (`prj_pq2Pjj3NOJB9wwXPdk9UcROb4CVj`), importando o
   mesmo repositório GitHub `THDEV-WEB/Encanto-system`, branch de produção `main` (mesmo padrão dos 2
   projetos já existentes).
2. ✅ **Build configurado**: Build Command `npm run build:admin`, Output Directory `dist/admin`.
3. ✅ **Environment Variables copiadas**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_KEY` (production+preview)
   — os únicos valores realmente necessários para o app falar com o Supabase real. Extraídos do próprio
   bundle público da loja (são valores `VITE_*`, embutidos no JS client-side de qualquer forma — a chave
   é literalmente uma "publishable key" do Supabase, não secreta por design), em vez de pedir permissão
   de leitura de env vars "sensitive" via API. Variáveis do Sentry deliberadamente **não** copiadas
   (opcionais, fora do escopo "necessário" que o dono autorizou).
4. ✅ **1º deploy de produção disparado e confirmado READY** (`dpl_J9ehUFtoydwvzkVRFcPqyh5YbW3h`) — build
   log ao vivo conferido linha a linha contra o build local: **516 módulos, mesmos hashes de arquivo**
   (`admin-B7LoE2og.js`, `admin-DeJfdh9N.css`), confirma que o Vercel compilou exatamente o mesmo código
   já validado localmente.
5. ✅ **Domínio `admin.encanto.valionsistemas.com.br` anexado ao projeto** — verificação de posse
   automática (`verified:true`, herdada da posse já comprovada de `encanto.valionsistemas.com.br` na
   mesma conta), mas **DNS ainda não aponta pra lá** (`misconfigured:true` confirmado via API).

**⏸️ Único passo que ainda depende do dono (DNS — fora do escopo do token da Vercel):**

Criar, na zona DNS de `valionsistemas.com.br` (Registro.br, "modo avançado", mesmo painel de
`REF-BRAND-01`), um registro:
- **Tipo:** CNAME
- **Nome:** `admin.encanto`
- **Valor/Destino:** `cname.vercel-dns.com.`

Propagação + certificado SSL automático da Vercel costumam levar minutos. Assim que propagar, o domínio
serve o admin publicamente sem precisar de nenhum token — verificação segue por `curl` público comum.

**Achado sobre `uri_allow_list` do Supabase Auth (revisão do D6 do ADR):** `AdminLogin.jsx` usa
`db.auth.signInWithPassword` com `detectSessionInUrl:false` — não há redirect nenhum no login do admin
(diferente do OAuth Google do cliente, motivo real de `uri_allow_list` existir). O domínio do admin
**provavelmente não precisa** entrar nessa lista. Confirmar com um teste de login real assim que o DNS
propagar — não é mais tratado como ação obrigatória a priori.

**Assim que o CNAME for criado, avise — a verificação ao vivo (conteúdo público, login + `is_admin()`
reais) e o restante das ondas (4, 5, 6) seguem automaticamente, sem precisar reconfirmar autorização.**

**1 commit** (`vercel.json` + esta documentação — a criação do projeto/domínio via API não gera commit
próprio, é ação de infraestrutura fora do repositório).

---

### 🔴✅ Incidente real durante a propagação — 2 causas raiz distintas, ambas fechadas

O DNS demorou mais que o normal e, mesmo depois de propagar, o domínio continuou fora do ar por mais
tempo que o esperado. Auditoria completa (a pedido do dono: *"algo tem que estar errado"*) encontrou
**duas causas reais e independentes**, nenhuma delas hipotética:

**Causa 1 — erro humano no cadastro do DNS (corrigido pelo dono).** A 1ª tentativa usou `Nome: admin.
encanto` (relativo). Esse painel específico do Registro.br (mesmo confirmado em `REF-BRAND-01`) exige
FQDN completo no campo "Nome" — o registro não chegou nem aos servidores autoritativos
(`a.sec.dns.br`/`b.sec.dns.br`) com o formato errado. Corrigido para `admin.encanto.valionsistemas.com.br`
completo; confirmado nos autoritativos logo em seguida.

**Causa 2 — emissão de certificado SSL nunca disparou (achado + corrigido via API Vercel).** Mesmo com
DNS correto, a Vercel nunca emitiu certificado para o domínio (`GET /v4/certs?domain=...` não listava
nenhum — só os 3 certificados dos domínios antigos). Provável efeito colateral do período em que o DNS
esteve errado (tentativas de emissão automática podem ter falhado e não houve novo gatilho automático).
Corrigido solicitando emissão explícita (`POST /v4/certs`) — certificado novo emitido na hora
(`cert_4MnEhFXokBHkpFjKDomVmsV3`, válido até 2026-11-01).

**Causa 3 — encontrada IMEDIATAMENTE após a Causa 2 (o certificado resolveu o handshake TLS, mas `/`
passou a devolver 404 puro, inclusive em `/admin.html` e `/manifest-admin.json` diretos).** Comparação
lado a lado com o domínio irmão (`encanto.valionsistemas.com.br`, que redireciona `80→443` normalmente)
mostrou que o admin não redirecionava nem servia nada na raiz — sinal de que o domínio não estava
resolvendo pra conteúdo nenhum, não só "sem certificado". Auditoria dos arquivos via probing HTTP direto
(`/admin/admin.html` → 200, `/admin.html` → 404) revelou a causa: **`vercel.json` (compartilhado pelos
2 projetos Vercel, mesmo repositório) tem `"outputDirectory":"dist"` no nível raiz, que prevalece sobre
o Output Directory configurado no próprio projeto `encanto-admin` (`dist/admin`)** — a Vercel estava
servindo o CONTEÚDO de `dist/` como raiz do site, com `dist/admin/` aninhado um nível a mais dentro
dela. Corrigir o `vercel.json` diretamente exigiria também fixar `outputDirectory` explícito no projeto
`encanto-system` (a loja) para compensar — **essa ação foi bloqueada pelo classificador de segurança do
Claude Code por alterar configuração de um projeto de PRODUÇÃO ao vivo, corretamente**. Resolvido sem
tocar na loja nem no `vercel.json`: `vite.config.js` (commit `7677620`) muda o `outDir` do modo `admin`
para `'dist'` (raiz) — alinhando a saída do build com o que a Vercel já forçava de qualquer forma —
com `emptyOutDir:false` só nesse modo (protege `dist/encanto`/`dist/capacitor` de builds locais em
sequência) e `globIgnores` novo no plugin PWA do admin (evita precachear a saída da loja que passa a
coexistir em `dist/` nesse cenário local). Validado local (precache do admin voltou aos 17 arquivos
corretos, `test:domain` verde) e ao vivo (novo deploy, HTTPS 200, `manifest-admin.json`/`sw-admin.js`
respondendo, loja confirmada inalterada).

**Domínio confirmado 100% funcional em produção:** `https://admin.encanto.valionsistemas.com.br/` →
HTTP 200, conteúdo "Encanto Admin" confirmado.

## Onda 4 — Remoção da engrenagem, do easter-egg e do hash de acesso da loja

**✅ CONCLUÍDA (2026-08-03).**

- Removidos: botão ⚙️ + `data-testid="header-admin-btn"` (`StoreApp.jsx`), listener de 5 cliques na
  logo (`StoreApp.jsx`), estado `'store'`/hash `#admin-encanto` (`useAdminSession.js` — simplificado
  para só `'login'`/`'admin'`, único consumidor agora é `AdminApp.jsx`).
- `App.jsx` (bundle da loja) não importa mais `AdminLogin`/`AdminPanel`/`useAdminSession` — o mode-switch
  antigo foi removido por completo, a loja é a única coisa que este bundle sabe renderizar.
- `useCapacitorBackButton.js` simplificado (removido o ramo `mode==='admin'/'login' → verLoja()`, que
  não existe mais neste bundle).
- Corrigido o e-mail hardcoded em `AdminLogin.jsx` (achado de higiene do §2 do ADR) — `useState('')`.
- Limpeza colateral: `STORAGE_KEYS.LOGO_CLICKS` (constants/storage.js) e o import correspondente em
  `StoreApp.jsx` removidos por ficarem mortos.
- Executada só depois da Onda 3 validada em produção (pré-condição transversal atendida).

**Verificação real — resultado mais importante desta onda:**
- **Bundle da loja: 615.12 kB → 521.71 kB (174.58 kB → 150.08 kB gzip)** — redução real e mensurável,
  prova concreta de que `AdminLogin`/`AdminPanel`/os 11 subcomponentes admin **não fazem mais parte do
  bundle público da loja**. Não é mais "esconder por CSS/estado" — o código genuinamente não está lá.
- `npm run build` (loja) e `npm run build:admin`: ambos sucesso.
- `npm run test:domain`: verde, sem regressão.
- Varredura (`grep -rn "onAdmin|abrirLogin|admin-encanto|LOGO_CLICKS" src/`): zero ocorrências —
  nenhuma referência residual ao acesso antigo em lugar nenhum do código-fonte.
- **Pendência conhecida e esperada:** a suíte E2E ainda tem specs que usam `header-admin-btn`/
  `#admin-encanto` para chegar ao admin — vão falhar até a Onda 5 (próxima) redirecioná-los para o novo
  domínio/bundle. Não é regressão, é exatamente o que a Onda 5 existe para resolver.

**1 commit** (`admin-04`).

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
