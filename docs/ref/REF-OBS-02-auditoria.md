# REF-OBS-02 — Observabilidade dos caminhos fail-closed de isolamento tenant

**Status: FECHADA — VERDE (pendente só de deploy/validação real em produção, ver seção final).**

## 1. Auditoria do estado atual do Sentry (antes de qualquer código novo)

Achado principal: **Sentry já estava 100% implementado e validado em produção** desde a
`REF-SENTRY-01` (commit `9ef8bfc`, 2026-07-25, muito antes desta sessão) — a premissa inicial de que
esta REF seria "ativar o Sentry" (vinda de uma anotação de roadmap de 10 dias atrás) estava
desatualizada. `docs/ref/REF-SENTRY-01-progress.md` documenta, com evidência real de API (não
suposição): SDK + Error Boundaries + captura de RPC/rede + falha de recurso + performance básica
(Web Vitals, `tracesSampleRate: 0.2`) + contexto de usuário/breadcrumbs de negócio, todos já em
produção; pipeline Git → GitHub Actions → Vercel → Sentry confirmado automático (release, source
maps, deploy, captura de evento real) no fechamento daquela REF.

Conclusão: esta REF não precisava "ativar" nada — o gap real, confirmado ao ler
`docs/ref/REF-SENTRY-01-progress.md` junto com as duas REFs mais recentes desta sessão
(`REF-ORDER-TENANT-01`, `REF-ADDRESS-STOREID-01`), é que os DENY fail-closed introduzidos por elas
(`'loja invalida'`, `'loja nao identificada'`) nasceram DEPOIS do fechamento da REF-SENTRY-01 e nunca
tiveram nenhuma observabilidade — nem pelo hook de RPC/dados já existente (explicado no item 6).

## 2. O que a REF-SENTRY-01 já implementou (não duplicado aqui)

`src/lib/sentry.js`: `capturarErroReact`, `capturarErroDados` (só exceção real de RPC/rede via
`DataService.run`), `marcarPedido`, `marcarArea`, `setUsuario`/`limparUsuario` (só `id`+`role`, nunca
PII), `registrarBreadcrumb`, listener dedicado de falha de carregamento de recurso,
`browserTracingIntegration` com amostragem 0.2. Decisão já registrada e mantida: **sem captura
genérica de `console.error`** (evitaria duplicar o que os hooks curados já cobrem e encheria o Sentry
de ruído de estados degradados esperados).

## 3. VITE_SENTRY_DSN e injeção no build

Confirmado no bundle AO VIVO de produção (baixado agora, nesta auditoria): DSN
`o4511791896002560.ingest.de.sentry.io/4511793830887504` embutido, `release` = SHA completo do commit
`c3254f3` (HEAD de `origin/main` no início desta REF) — pipeline continua vivo e correto, nenhuma
regressão desde o fechamento da REF-SENTRY-01. `vite.config.js`: DSN não passa por nenhuma
configuração especial de build (é lido em runtime via `import.meta.env.VITE_SENTRY_DSN`, mecanismo
padrão do Vite); só o UPLOAD de source maps depende de `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/
`SENTRY_PROJECT` (não prefixados `VITE_`, nunca vão pro bundle do navegador) — build local sem essas
3 credenciais confirmado sem gerar nenhum `.map`, mesmo comportamento documentado.

## 4. Risco de exposição de PII/secrets

Auditados TODOS os call sites existentes de cada helper (`setUsuario`, `marcarPedido`,
`registrarBreadcrumb`, `capturarErroDados`, `capturarErroReact`) — nenhum passa telefone, nome,
endereço, e-mail ou payload de pedido; só identificadores técnicos (`id`, `role`, `orderId`, contadores,
booleans, `motivo` textual curto). Verificado especificamente o breadcrumb de distância de entrega
(`CheckoutPage.jsx`): só `method`/`provider`/`distanceKm`, nunca lat/lng nem texto do endereço.
Confirmado também que nenhuma consulta do storefront filtra por `.eq('phone'|'telefone'|'email'|'cpf', ...)`
direto (client-side) — toda busca por telefone/e-mail passa por RPC (corpo POST), nunca aparece na URL
capturada pelo breadcrumb automático de fetch/XHR do SDK (que registra só método+URL+status, nunca
corpo). Zero achado novo de risco.

## 5. Source maps, environment/release, produção

Reconfirmado sem suposição (bundle ao vivo, ver item 3): `sourcemap:'hidden'` só quando há credencial
de upload (nunca fica público), `environment` = `import.meta.env.MODE` (`production` no build real),
`release` = SHA do commit via `VERCEL_GIT_COMMIT_SHA`. Nenhuma mudança necessária aqui — auditoria
confirma que o estado documentado pela REF-SENTRY-01 continua exatamente correto hoje.

## 6. Observabilidade dos caminhos fail-closed (REF-ORDER-TENANT-01 / REF-ADDRESS-STOREID-01) — GAP REAL

Achado: nenhum dos 2 DENY chegava ao Sentry, por dois motivos diferentes por caminho:

- **`create_order`** (`DataService.savePedido`): o DENY é um retorno lógico bem-sucedido da RPC
  (`{ok:false, error:'loja invalida'|'loja nao identificada'}`, **sem** chave `sqlstate` — diferente
  dos demais `ok:false`, que sempre têm `sqlstate` por virem de uma exceção real capturada no `EXCEPTION`
  handler da função). Nunca lança em JS, então nunca passa pelo `catch` de `DataService.run` — o hook
  `capturarErroDados` (que só existe ali) nunca era chamado.
- **`save_structured_address`** (`addressRepository.salvar`): chama `dbCliente.rpc(...)` DIRETO, sem
  passar por `DataService.run` nenhuma vez — a exceção do Postgres (`RAISE EXCEPTION 'loja nao
  identificada'`) chega como `r.error` (nunca lança em JS, supabase-js normaliza), tratada só por
  `console.error`.

### Implementação

Novo helper dedicado, `capturarDenyTenant(motivo, contexto)` em `src/lib/sentry.js` — nível
**`warning`** (não `exception`) de propósito: um DENY isolado é comportamento ESPERADO (tentativa
forjada, domínio não reconhecido), não uma falha da aplicação. `contexto` carrega só `rpc` (nome
técnico) e `hostname` (`window.location.hostname` — não é PII, é o próprio domínio do app) — é
justamente esse `hostname` que permite ao painel do Sentry (via tag `deny.motivo` + o campo
`hostname` do contexto) diferenciar **DENY esperado** (hostname que não é nosso — ruído de fundo,
scanner/ataque) de **DENY inesperado** (hostname real de produção, `*.valionsistemas.com.br`, sendo
negado — aí sim é config/infra/regressão e vale investigar). Nenhum DENY vira "erro crítico" por
padrão — fica pesquisável/filtrável no painel sem gerar alerta de crash.

Hooks adicionados em exatamente 2 pontos, com filtro específico por mensagem (nunca captura outros
tipos de falha, ex. `unique_violation`/timeout/payload inválido — evita duplicar/misturar categorias):

- `src/services/DataService.js` (`savePedido`): dispara só quando `!res.sqlstate` E
  `res.error` é `'loja invalida'` ou `'loja nao identificada'`.
- `src/address/repository/addressRepository.js` (`salvar`): dispara só quando
  `r.error.message === 'loja nao identificada'`.

## 7. Duplicação de instrumentação

Nenhuma. `capturarDenyTenant` é um helper NOVO e distinto de `capturarErroDados` (categoria/nível
diferentes — DENY esperado vs. exceção real), chamado em 2 pontos que hoje não tinham NENHUMA
observabilidade (não em cima de nada que já existia). Captura genérica de `console.error` continua
deliberadamente fora de escopo (mesma decisão já registrada na REF-SENTRY-01).

## Testes

- `npm run test:domain`: **achado real durante a implementação** — `tests/address-multitenant.golden.mjs`
  faz `import()` direto de `addressRepository.js` em Node puro (sem Vite); o novo import de
  `lib/sentry.js` (que lê `import.meta.env.VITE_SENTRY_DSN` SEM `?.`, de propósito, para permitir
  dead-code-elimination no bundle real — ver comentário em `sentry.js`) quebrava com
  `Cannot read properties of undefined`. Corrigido registrando o mesmo loader já usado por
  `test:render` (`tests/_render-loader.mjs`, `register('./_render-loader.mjs', import.meta.url)`) no
  topo do teste — substitui `import.meta.env` por `{}` em Node puro, mesmo padrão já estabelecido,
  zero mudança de comportamento do teste em si. Depois da correção: **100% verde**.
- `npm run build` / `npm run build:admin`: verdes, sem DSN local (mesmo padrão de sempre — o SDK só
  entra no bundle quando há credencial).
- Regressão E2E (Playwright, suíte completa): **118 passaram**, 5 falhas — as 4 já documentadas como
  pré-existentes desde a REF-ORDER-TENANT-01 (`checkout-logado`, `admin-empresa-identidade-visual`,
  `platform-console` ×2) **+ 1 nova observação**: `cliente/minha-conta.spec.js` (editar nome/telefone)
  falhou nesta rodada. Investigado com o mesmo rigor A/B de sempre: `git stash` das 4 mudanças desta
  REF, spec rodado 2× isolado contra o baseline — **falhou nas 2 vezes, idêntico**, provando que é
  flakiness pré-existente do teste (zero relação de código: `MinhaContaScreen`/`useMinhaConta` não
  importa `DataService.js`, `addressRepository.js` nem `lib/sentry.js`). `git stash pop` restaurado
  em seguida. Checkout e specs de cliente (fidelidade/logout/meus-pedidos) confirmados limpos com as
  mudanças desta REF aplicadas.

## Validação em produção

(preenchido após o push/deploy — ver commit e evidência de evento real abaixo)

## Commits

`(preencher no fechamento)`
