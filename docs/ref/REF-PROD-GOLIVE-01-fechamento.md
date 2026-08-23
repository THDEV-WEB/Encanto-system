# REF-PROD-GOLIVE-01 — Correções pré-go-live da Encanto

**Status: FECHADA — correções aplicadas e validadas em produção (2026-08-23).**

## Contexto

A auditoria pré-go-live (REF-PROD-READINESS-01, somente leitura) encontrou 4 achados
classificados como bloqueadores reais. Esta frente teve autorização explícita do dono para
corrigir os que afetam diretamente a operação da Encanto (que retoma produção real), sem
tentar deixar toda a plataforma multi-tenant perfeita hoje.

## O que foi corrigido

### 1. MT-01 / MT-02 — isolamento cross-tenant em `create_order`/`link_customer_to_auth`

**Achado:** as duas RPCs confiavam cegamente no `p_store_id` enviado pelo cliente sempre que
o JWT autenticado ainda não tinha `tenant_id` (conta nova, nunca comprou em loja nenhuma —
condição gratuita, só um login por e-mail/OTP ou Google). Um atacante podia criar pedidos ou
se vincular como cliente em qualquer loja da plataforma só trocando o parâmetro.

**Correção:** quando `tenant_id` está ausente do JWT, as duas RPCs passam a derivar a loja de
`resolve_store_from_origin()` — a mesma fonte já usada e testada no caminho guest — nunca mais
do parâmetro cru do cliente. Quando `tenant_id` está presente, nada muda.

`resolve_store_from_origin()` ganhou 1 ramo aditivo reconhecendo o Origin `https://localhost`
(confirmado no código-fonte do pacote `@capacitor/android` instalado — `CapConfig.java`, único
Origin que o app Android consegue emitir, pois o WebView carrega os arquivos localmente do
APK) como o app nativo da Encanto, sempre resolvendo para `default_store_id()` — nunca aceita
`p_store_id` do payload nesse ramo. Sem isso, a correção quebraria o primeiro pedido de
qualquer cliente novo dentro do app, confirmado em uso real hoje pelo dono.

**Arquivos:**
- `migrations/REF-PROD-GOLIVE-01-fix-tenant-validation.sql` (aplicada em produção)
- `migrations/REF-PROD-GOLIVE-01-fix-tenant-validation-rollback.sql`
- `scripts/prod-golive-01-tenant-fix-test.mjs` — 13/13 cenários (ataque + regressão + app
  nativo) validados direto contra produção dentro de `BEGIN...ROLLBACK`, zero mutação líquida
  confirmada por query read-only após a execução.

**Fora do escopo, registrado e não corrigido nesta rodada:** o
`INSERT ... ON CONFLICT (store_id, phone) DO UPDATE SET name` em `create_order()` não verifica
`auth_user_id` do customer existente — um autenticado que descubra o telefone de um cliente
real da própria Encanto ainda pode sobrescrever o nome do cadastro dele. Vetor mais sutil,
adiado para não expandir o risco desta correção crítica antes do go-live.

### 2. CHECKOUT-TENANT-02 — catálogo pode misturar produtos de lojas diferentes no boot

**Achado:** `getCats`/`getProds`/`getAds` não filtram por `store_id` enquanto a resolução
assíncrona da loja (`get_store_by_domain`, não-bloqueante por decisão da REF-PERF-01) não
termina — com 2+ lojas ativas ao mesmo tempo, quem monta primeiro podia buscar o catálogo
misturado e ficar preso em cache pelo resto da sessão.

**Correção estrutural (frontend):** novo barramento de evento dedicado
(`src/services/storefrontResolvedBus.js`, mesmo padrão de `productCacheBus.js`) que o
`StorefrontProvider` dispara assim que a loja resolve — os 3 hooks de catálogo
(`useProducts`, `useCategories`, `useAdicionais`) assinam esse evento, invalidam seu cache e
refazem o fetch, agora corretamente filtrado. Dispara no máximo 1x por sessão; não bloqueia o
primeiro render (decisão de performance da REF-PERF-01 preservada).

**Mitigação imediata (banco, já aplicada):** a Aquarios Bar (confirmado: zero produtos,
categorias, pedidos e clientes reais) foi posta em `status='suspenso'` — isso desliga
`store_ativo(store_id)`, removendo seu catálogo da leitura pública via RLS e fechando o
vazamento estruturalmente no banco, independente de qualquer timing de frontend. Reversível
com um único `UPDATE` de volta para `'ativo'` quando o onboarding for retomado.

**Arquivos:**
- `src/services/storefrontResolvedBus.js` (novo)
- `src/providers/StorefrontProvider.jsx`
- `src/hooks/useProducts.js`
- `src/hooks/useCategories.js`
- `src/hooks/useAdicionais.js`

## Validação técnica local

- `npm run lint` → 0 erros (53 warnings pré-existentes, +1 warning cosmético novo idêntico ao
  padrão já aceito em `productCacheBus.js`)
- `npm run typecheck` → limpo
- `npm run test:domain` → 40/40, exit 0
- `npm run build` → sucesso, 612 módulos

## Deploy e validação real em produção

Commit `2c86e73` (branch local) → aplicado isoladamente via `git worktree` + cherry-pick como
`d6f2e61` em cima do `origin/main` vigente no momento, para não misturar com o trabalho
concorrente de outras frentes/sessões ativas durante esta mesma janela (REF-CI-02,
REF-STORE-ONBOARD-01 Onda 3). Outra sessão posteriormente reconciliou tudo num merge commit
(`898daf1`) — confirmado via `git merge-base --is-ancestor` que `d6f2e61` está incluído.

Smoke test real pós-deploy (2026-08-23):

| Item | Resultado |
|---|---|
| Storefront HTTPS (`encanto.valionsistemas.com.br`) | 200 OK |
| `get_store_by_domain` resolve para Encanto | OK |
| Catálogo público (38 produtos) | 100% pertencem à Encanto, zero vazamento de outra loja |
| Categorias (9) / adicionais (35) | Números batem com o histórico conhecido |
| Horário de funcionamento (RPC pública) | Dados reais retornados |
| Dados institucionais (`company_info`) | Dados reais retornados |
| Taxa de entrega por distância | Faixas reais retornadas |
| Admin (`admin.encanto.valionsistemas.com.br`) | 200 OK |

Carrinho/endereço/login/checkout guest/criação de pedido/idempotência não foram re-exercitados
via HTTP real pós-deploy para não criar dado de teste espúrio em produção — já haviam sido
exaustivamente validados nos 13/13 cenários acima, dentro de transações com `ROLLBACK`.

## Nota operacional durante a execução

O monitoramento automatizado do deploy (polling via `curl` a cada 15s por ~10 minutos, sem
User-Agent de navegador) disparou o Vercel Attack Challenge Mode (`HTTP 403`,
`X-Vercel-Mitigated: challenge`) no domínio de produção — resolvido sozinho ao parar o polling
e usar requisições únicas e espaçadas com User-Agent de navegador real. Não há evidência de
que isso tenha afetado visitantes reais (mecanismo de mitigação por origem/IP da própria
Vercel), mas fica registrado como lição operacional para futuras validações: preferir
verificações espaçadas e com User-Agent real a polling agressivo contra domínios de produção.

## Addendum (mesmo dia) — vetor secundário fechado + teste real de ponta a ponta

Depois do fechamento inicial acima, o dono pediu para fechar também o vetor secundário e para
validar o caminho real (não só transacional) de criação de pedido.

### 3. Vetor secundário — sobrescrita de nome via telefone em `create_order`

**Correção:** o `INSERT ... ON CONFLICT (store_id, phone) DO UPDATE SET name` agora só
sobrescreve o nome quando o customer existente ainda não tem `auth_user_id` (guest/órfão —
comportamento legado 100% preservado) ou quando `auth_user_id` já é o do próprio chamador. Nos
demais casos (telefone de outra conta autenticada), o pedido continua sendo criado normalmente
e vinculado ao `customer_id` correto — só o nome deixa de ser sobrescrito.

**Arquivos:**
- `migrations/REF-PROD-GOLIVE-01-fix-name-overwrite.sql` (aplicada em produção)
- `migrations/REF-PROD-GOLIVE-01-fix-name-overwrite-rollback.sql`
- `scripts/prod-golive-01b-name-overwrite-test.mjs` — 6/6 cenários (1 ataque + 3 regressões
  legítimas) validados dentro de `BEGIN...ROLLBACK`, zero mutação líquida confirmada.

### Teste real de ponta a ponta (fora de transação, via REST público)

Para fechar a lacuna de validação registrada no fechamento original (a lógica só havia sido
exercitada dentro de `ROLLBACK`, nunca pelo caminho real completo), foi feita 1 chamada HTTP
real ao endpoint público (`POST .../rest/v1/rpc/create_order`, mesma chave anônima e mesmo
header `Origin` que o navegador de um cliente real usa), criando um pedido de verdade:

- `POST` retornou `{"ok": true, "order_id": "..."}`.
- Confirmado via query read-only: pedido persistido com `store_id` correto (Encanto), customer
  criado corretamente, item com nome/quantidade/preço corretos, status `recebido`.
- Registro de teste removido logo em seguida (`DELETE` de `order_items`/`orders`/`customers`
  pelos IDs exatos, confirmado que o customer não tinha nenhum outro pedido vinculado antes de
  remover). Confirmado por query read-only final: zero resquício.

Isso fecha a lacuna: o caminho real (REST → RLS/grants → RPC → banco) está confirmado
funcionando de ponta a ponta, não só a lógica da função isoladamente.

## Pendências que continuam em aberto (fora do escopo desta frente)

- A2 (PII em repositório público) e A6 (senha do admin da Aquarios Bar) — decisões de
  governança que dependem do dono, não tocadas aqui.
- Reativação da Aquarios Bar (`status='ativo'`) só deve acontecer depois de validar a correção
  do CHECKOUT-TENANT-02 em uso real com 2 lojas simultâneas — decisão do dono.
