# REF-AUTH-02 — Separação definitiva entre Loja e Painel Administrativo

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Commit-base desta REF:** `1f3a8c5` (REF-REGRESSION-01, já commitada, pushada e em produção).
**Regra do dono para esta REF:** correção cirúrgica; só commitar depois de toda a validação verde.

## Estado atual

✅ CONCLUÍDA. Causa raiz identificada e corrigida, validação completa (build + testes de domínio +
suíte E2E 107/107) 100% verde. Aguardando aprovação do dono para o commit.

## Relato do dono

Ao acessar `https://encanto-system.vercel.app/` (domínio principal), o navegador abria diretamente o
Painel Administrativo, sem passar pela tela de login. Teste controlado do dono: existia a chave
`encanto-admin-auth` no localStorage; removendo só essa chave (`localStorage.removeItem(...)`), o
domínio passou a abrir a Loja normalmente após reload.

## Causa raiz (comprovada por leitura de código, não hipótese)

`src/hooks/useAdminSession.js` decidia a tela inicial em duas etapas, e as duas usavam a mera
**existência** de uma sessão salva como critério — nunca a **escolha do usuário** de entrar no fluxo
administrativo:

1. **1º render (síncrono):** `possivelSessaoAdmin() ? 'checking' : 'store'` — bastava a chave
   `encanto-admin-auth` existir em `localStorage` (sem checar validade) para o estado inicial ser
   `'checking'` em vez de `'store'`.
2. **Efeito de restauração (assíncrono):** `db.auth.getSession()` resolvia, e se a sessão fosse
   válida + autorizada (`is_admin()`), a promoção para `mode='admin'` acontecia a partir de
   **qualquer** modo anterior, incluindo `'store'` — via
   `setMode((m) => (m === 'store' || m === 'login' || m === 'checking' ? 'admin' : m))`.

Ou seja: **autenticação (sessão Supabase válida) e "o usuário decidiu entrar no fluxo admin" nunca
foram conceitos separados no código** — a sessão persistida, sozinha, bastava para decidir a tela
inicial do domínio principal. Não era bug de deploy, de RLS ou de `is_admin()` (que continua correto
e é quem barra qualquer usuário sem privilégio, ver REF-REGRESSION-01 · P1) — era a máquina de estados
do próprio hook tratando "existe sessão" como sinônimo de "abrir o painel".

## Solução adotada

Novo conceito, isolado do conceito de sessão: **"o usuário já escolheu entrar no fluxo administrativo
NESTA ABA"**, representado por uma chave nova em `sessionStorage` (nunca `localStorage`) —
`ADMIN_FLOW_SESSION_KEY` (`'encanto-admin-flow'`, `src/constants/authStorage.js`, ao lado das 2 chaves
de sessão já centralizadas ali desde a REF-ADMIN-03).

**Por que `sessionStorage` e não `localStorage`:** `sessionStorage` é isolado por aba e não sobrevive a
uma aba/janela nova — exatamente o comportamento pedido ("aba anônima sempre Loja"). Ao mesmo tempo,
sobrevive a um F5 na mesma aba — preservando "refresh dentro do painel continua no painel", já
validado e coberto por E2E desde a REF-ADMIN-01/02. Persistência de sessão (Supabase, `localStorage`)
e "tela inicial desta aba" viram, na prática, dois eixos independentes.

**Mudanças em `useAdminSession.js`:**
- 1º render: `'checking'` só quando `estaNoFluxoAdmin() && possivelSessaoAdmin()` — os DOIS precisam
  ser verdade (sessão salva E o usuário já tinha entrado no fluxo nesta aba). Sem o flag, é sempre
  `'store'`, mesmo com sessão de Admin válida salva.
- Acesso via hash `#admin-encanto` continua indo direto para `'login'` (comportamento inalterado —
  entrada explícita), mas agora também marca o flag.
- `abrirLogin()` (clique na engrenagem) e `entrar()` (login manual bem-sucedido) marcam o flag.
- `sair()` (logout real) e os dois caminhos de demoção por sessão inválida/ausente
  (`promoverSeAutorizado` com `autorizado===false`, e o `onAuthStateChange` sem sessão) limpam o flag.
  `verLoja()` ("← Ver loja") **não** mexe no flag — continua sendo uma prévia, não um logout
  (comportamento pré-existente preservado integralmente).
- `promoverSeAutorizado`: a promoção para `'admin'` nunca mais parte de `mode==='store'` — só de
  `'login'`/`'checking'`. Esse é o gate real do fix: uma sessão válida pode ser confirmada em
  background o quanto for, mas isso sozinho nunca tira o usuário da Loja.
- **Novo efeito** (`useEffect` com dep `[mode]`, restrito a `mode==='login'||'checking'`): reconfirma a
  sessão sempre que o usuário entra no fluxo em runtime. Necessário porque o efeito de mount já pode
  ter resolvido a checagem ANTES do clique na engrenagem (aba aberta há tempo, sessão válida) — naquele
  momento `mode` ainda era `'store'` e a promoção foi bloqueada de propósito pelo gate acima; sem este
  efeito, uma sessão genuinamente válida forçaria login de novo ao clicar na engrenagem, quebrando a
  validação "Admin autenticado → Engrenagem → Painel direto". Mantém a arquitetura de dupla checagem já
  documentada e deliberadamente preservada na REF-ADMIN-03 (não é duplicação acidental).

**Por que a Loja é sempre o fallback (nunca Login) num F5 dentro do painel com sessão expirada:**
comportamento pré-existente, não alterado — é o gate do domínio principal (`'store'`) que muda nesta
REF, não o fallback de uma sessão que se prova inválida DEPOIS de já estar dentro do fluxo. Ao tentar
reentrar no Admin depois disso (engrenagem/hash), o caminho é sempre `'login'` (nunca `'checking'`),
mostrando a tela de Login normalmente — valida o requisito "sessão expirada → tela de Login".

**`src/pages/StoreApp.jsx`:** adicionado `data-testid="header-admin-btn"` ao botão ⚙️ da engrenagem
(único ajuste de produção fora do hook) — necessário para o novo teste E2E clicar o botão real (não só
navegar pelo hash), provando o fluxo que o dono efetivamente usa.

## Auditoria adicional (pedida explicitamente)

Toda a cadeia de decisão de tela inicial foi relida: `App.jsx` (só consome `mode` do hook, nenhuma
lógica própria de gate), `StoreApp.jsx` (só chama `onAdmin` no clique, nenhum estado próprio),
`AdminLogin.jsx` (checagem de `is_admin()` só no submit do formulário, nunca no mount — não interfere),
`lib/supabase.js` (migração da chave legada, roda 1x no load do módulo, não decide tela nenhuma),
`AuthProvider`/`AuthService`/`dbCliente` (sessão do CLIENTE, gate completamente separado, nunca cruza
com o do Admin). **Único ponto de decisão de tela inicial em todo o projeto: `useAdminSession.js`** —
não havia duplicação de lógica em outro lugar, nem um segundo fluxo não auditado.

## Compatibilidade

- Todas as 7 validações originais de sessão do Admin (F5 no painel, flash do catálogo, hash já
  autenticado, sessão forjada, migração da chave legada, "Ver loja" vs "Sair") continuam passando —
  ver evidências abaixo.
- Nenhuma mudança em `is_admin()`, RLS, `AuthProvider`, checkout, ou qualquer query.
- Nenhuma mudança de comportamento aprovada anteriormente (REF-REGRESSION-01 · P1) foi alterada — só
  reforçada: agora o usuário sem privilégio nunca vê nem o flash do painel, em nenhum cenário.

## Testes e evidências

**Novo teste E2E** (`e2e/tests/admin/admin-sessao.spec.js`) reproduz o cenário exato relatado pelo
dono: injeta uma sessão de Admin REAL e válida via `storageState` (não forjada), abre o domínio
principal numa aba nova (sem hash) e prova que a Loja aparece — `[data-prod]` visível,
`admin-tab-dashboard` com `toHaveCount(0)`. Em seguida clica na engrenagem real
(`header-admin-btn`) e prova que o painel abre direto, sem pedir login de novo
(`admin-login-senha` com `toHaveCount(0)`).

O teste de migração da chave legada (REF-ADMIN-03) foi ajustado para o novo comportamento: antes
esperava o painel abrir direto no `goto(baseURL)`; agora espera a Loja primeiro, e só abre o painel
(sem relogin) depois do clique na engrenagem — preserva 100% da cobertura original (migração +
sem forçar relogin), alinhado à nova regra.

**Arquivos alterados (4, todos pertencentes a esta REF):**
- `src/constants/authStorage.js` — nova constante `ADMIN_FLOW_SESSION_KEY`
- `src/hooks/useAdminSession.js` — o fix em si (gate + novo efeito + marcação/limpeza do flag)
- `src/pages/StoreApp.jsx` — `data-testid="header-admin-btn"` (suporte ao teste)
- `e2e/tests/admin/admin-sessao.spec.js` — 1 teste novo + 1 teste ajustado ao novo comportamento
  esperado + comentário de topo atualizado

**Resultados:**
- `npm run build`: limpo (580,79 kB / gzip 163,65 kB).
- `npm run test:domain`: 100% verde (todos os scripts, incluindo `test:deps`, `test:admin-addons`,
  `test:addon-labels`).
- `npm run test:e2e` (suíte Playwright completa, chromium): **107/107 verdes** (era 106 antes desta
  REF — 1 teste novo). Inclui `admin-permissao.spec.js` (proteção P1 continua intacta),
  `admin-logout.spec.js` (Ver loja/Sair inalterados), e as 4 verificações pré-existentes de sessão do
  Admin (F5 no painel, flash, hash autenticado, sessão forjada).

## PRÓXIMO PASSO

Apresentar relatório final ao dono. Somente commitar após aprovação explícita — nenhum commit foi
realizado até este ponto.
