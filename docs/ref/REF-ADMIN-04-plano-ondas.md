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

- Novo `manifest.json` do admin: `name`/`short_name`="Encanto Admin", ícone próprio (a definir com o
  dono — reaproveitar variação do ícone oficial já existente, mesma técnica de recorte/cache-busting
  físico documentada em `REF-MOBILE-01`), `scope`/`start_url`/`id` apontando para o domínio do admin
  (não para `/encanto/`).
- Segunda instância do Service Worker (mesma config Workbox/`vite-plugin-pwa` já validada — sem
  `runtimeCaching`, `registerType:'prompt'`), registrada no `admin.html`.
- Meta tags PWA (`apple-mobile-web-app-*`, `theme-color`, favicons) no `admin.html`, espelhando o
  padrão já usado no `index.html` da loja.
- **Verificação:** manifest/ícones/SW do admin respondem 200 em preview local; instalação manual (`Add
  to Home Screen`/ícone de instalação do Chrome) testada em pelo menos um navegador desktop, gerando um
  ícone "Encanto Admin" distinto do "Encanto" da loja.
- **1 commit.**

## Onda 3 — Terceiro projeto Vercel + domínio + Supabase Auth

- Novo projeto Vercel importando o mesmo repositório GitHub (`THDEV-WEB/Encanto-system`), Root
  Directory/Build Command/Output Directory apontando para a saída do admin (Onda 1).
- Domínio confirmado na Onda 0 anexado a esse projeto.
- `uri_allow_list` do Supabase Auth (projeto `hvbcdxsagkjtfjwvnslo`) atualizado com o novo domínio, mesmo
  procedimento de `REF-BRAND-01`.
- **Verificação:** deploy ao vivo do novo domínio serve o build do admin (confirmado por conteúdo, não
  só por hash — mesma técnica já usada em REFs anteriores: grep de uma string exclusiva do bundle do
  admin na resposta ao vivo); login completo e `is_admin()` testados em produção real; loja
  (`encanto.valionsistemas.com.br`) confirmada inalterada.
- **Esta é a onda que primeiro tem impacto em produção** — requer autorização explícita do dono antes de
  criar recursos novos na Vercel/Supabase (mesmo padrão de toda ação que afeta infraestrutura
  compartilhada neste projeto).
- **1 commit** (de configuração/documentação; a criação do projeto Vercel em si é uma ação de
  infraestrutura, não um commit de código).

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
