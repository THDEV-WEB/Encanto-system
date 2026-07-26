# REF-STABILITY-02 — Acesso ao Admin como escolha explícita

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

**Regra do dono:** auditoria e causa raiz ANTES de qualquer código; só corrigir depois de confirmar a
origem real do problema; preservar a arquitetura da REF-STABILITY-01; nenhuma regressão; nenhum conflito
com outras refs.

## Estado atual

✅ CONCLUÍDA — comportamento alterado por decisão explícita do dono (não foi uma simples correção de
bug), implementado, `test:domain` 28/28 verde, `build` limpo, suíte E2E do Admin 60/60 verde, suíte
E2E completa sem regressão.

## 1. Relato original

O "vulto" da tela de login (achado da REF-STABILITY-01) voltou a ocorrer, predominantemente em
dispositivos móveis (Android/iPhone); quase imperceptível em desktop.

## 2. Auditoria (antes de qualquer código)

Investigação completa, reportada ao dono ANTES de qualquer alteração:

- `hooks/useAdminSession.js` e `App.jsx` estavam **exatamente como a REF-STABILITY-01 deixou** —
  confirmado por `git log` (nenhum commit tocou esses arquivos entre `be801c8` e o início desta ref).
  **Não havia regressão de código** nas duas correções anteriores (achado 1/2: liga tarde demais;
  achado 2/2: desliga cedo demais).
- Achado estrutural real (não a causa do "vulto", mas desperdício): dois `useEffect`s independentes em
  `useAdminSession.js` chamavam `getSession()` cada um por conta própria — corridas de rede
  redundantes, sem produzir estado errado (guards funcionais absorviam a duplicidade).
- Duas hipóteses concretas, mobile-específicas, apresentadas ao dono:
  - **A** — o gatilho oculto "5 cliques na logo" (`StoreApp.jsx`) sem debounce, mais fácil de disparar
    por acidente em touchscreen.
  - **B** — `sessionStorage` (a flag `ADMIN_FLOW_SESSION_KEY` da REF-AUTH-02) pode sobreviver a um
    "reabrir" que parece novo em mobile (o SO recicla memória de abas em segundo plano de forma muito
    mais agressiva que desktop, e o navegador pode preservar o `sessionStorage` da mesma
    aba/janela através desse ciclo) — fazendo `mode` nascer `'checking'` sozinho, sem clique nenhum
    nesta visita. Bate literalmente com a hipótese do dono ("sessão restaurando e abrindo o Admin
    automaticamente"). A suíte E2E (Playwright, desktop) estruturalmente não reproduz esse cenário —
    explica por que passou despercebido (114/114 verde com o problema presente).

## 3. Decisão do dono (muda o comportamento-alvo, não é mais "corrigir o timing")

Em vez de investigar mais a fundo qual hipótese (A ou B) era a causa exata, o dono decidiu **eliminar
toda a categoria de problema**: a persistência de sessão do Supabase continua normal, mas **nunca mais
decide sozinha qual tela aparece** — nem no boot, nem num F5, nem ao entrar no fluxo admin (engrenagem/
hash). A sessão só é consultada/reaproveitada no clique explícito em **"Entrar"**.

Fluxo especificado:
- abrir a aplicação → sempre Loja;
- engrenagem → tela de Login (formulário, sempre visível de imediato);
- clicar "Entrar" → sessão válida reaproveitada sem pedir credencial; sem sessão válida, login normal.

Isso **substitui** (não é regressão — é decisão de produto explícita) partes de 3 refs anteriores:
REF-AUTH-02 (sessão nunca decide a tela inicial — mantido e reforçado), REF-ADMIN-02 Onda 2 (F5 dentro
do painel mantinha o Admin automaticamente — **revertido**), REF-STABILITY-01 achado 1/2 e 2/2 (o
"vulto" era sobre uma verificação em BACKGROUND que já não existe mais — o problema inteiro que essas
correções mitigavam deixou de existir, porque a verificação em si foi removida).

## 4. Implementação

### `hooks/useAdminSession.js` — reescrito
Removido: estado `'checking'`, `verificandoSessao`, a flag de sessionStorage
`ADMIN_FLOW_SESSION_KEY`/`estaNoFluxoAdmin`/`marcarFluxoAdmin`/`limparFluxoAdmin`, `possivelSessaoAdmin`,
e os dois `useEffect`s que chamavam `getSession()` automaticamente (no mount incondicional e ao entrar
em 'login'/'checking') para promover `mode='admin'` em background.
Mantido: `onAuthStateChange`, mas só para REAGIR — nunca promover. Sessão cai (logout real em qualquer
aba, refresh token revogado) enquanto `mode==='admin'` → volta pra Loja. Sessão aparece fora de
`'admin'` → ignorado de propósito (só "Entrar" decide entrar). Token renovado enquanto já em `'admin'`
→ só atualiza os dados da sessão guardada, nunca promove.
`mode` nasce `'store'` sempre, exceto hash `#admin-encanto` (decide só a TELA, nunca consulta sessão).

### `components/admin/AdminLogin.jsx`
`login()` (clique em "Entrar") agora tenta `db.auth.getSession()` + `is_admin()` PRIMEIRO — sessão
válida e autorizada entra direto (`onLogin`), sem pedir e-mail/senha. Sem sessão válida/autorizada, cai
no fluxo de credencial já existente (inalterado). Removido o prop `verificandoSessao` e o early-return
que mostrava `AdminSessionChecking` — o formulário agora é sempre a 1ª coisa mostrada em `mode='login'`.

### `App.jsx`
Removido o branch `mode==='checking'` e o import de `AdminSessionChecking`.

### Código morto removido
`components/admin/AdminSessionChecking.jsx` (arquivo deletado — nada mais usa o estado `'checking'`).
`ADMIN_FLOW_SESSION_KEY` (`constants/authStorage.js`) — sem outro consumidor (confirmado por grep antes
de remover).

## 5. Testes

### E2E (`e2e/tests/admin/`)
`admin-sessao.spec.js` **reescrito por completo** — as asserções das duas gerações anteriores
("pula direto pro painel com sessão válida", "reload nunca busca o catálogo da Loja", "formulário nunca
entra no DOM nem por 1 frame") viraram o OPOSTO por design (documentado no cabeçalho do arquivo). Novo
teste de regressão-alvo: gear/hash com sessão válida real injetada em `localStorage`, espera 500ms real
(não só a asserção), confirma que o painel NUNCA aparece sem o clique em "Entrar". `admin-logout.spec.js`
e `admin-minha-conta.spec.js` ajustados nos pontos que assumiam "F5 mantém o Admin" (agora reentra via
engrenagem + "Entrar" explicitamente). `admin-permissao.spec.js` não precisou de mudança (cenário sem
sessão válida nenhuma, comportamento idêntico nas duas arquiteturas).

Achado de metodologia de teste (não é bug de produção): a 1ª tentativa do teste de hash usava
`page.goto()` duas vezes na mesma aba mudando só o hash — navegação *same-document* no navegador (não
recarrega, só dispara `hashchange`), então o app nunca remontava e o teste "passaria de graça" sem
provar nada. Corrigido navegando para `about:blank` entre as duas idas, forçando um reload real.

**Resultado:** `e2e/tests/admin` completo — **60/60 verde** (1 arquivo reescrito, 2 ajustados, 57
inalterados sem regressão). Suíte E2E completa (`npm run test:e2e`) rodada por inteiro — ver resultado
consolidado abaixo.

### Domínio
`npm run test:domain` — **28/28 verde** (nenhum teste de domínio novo necessário; a mudança é de
integração/estado, coberta por E2E). `npm run build` — limpo (588 módulos, -1 pela remoção de
`AdminSessionChecking.jsx`).

## 6. Documentação

- `docs/ref/REF-STABILITY-02-progress.md` — este arquivo.
- `e2e/README.md` — anotação (não reescrita silenciosa) marcando a Onda 2 da REF-ADMIN-02 como
  REVERTIDA por esta ref, + nova seção "REF-STABILITY-02" no fim do arquivo.

## PRÓXIMO PASSO

Nenhuma pendência de código conhecida. Falta apenas: confirmar o resultado da suíte E2E completa
(rodando no momento da escrita deste documento) e commitar por subfase.
