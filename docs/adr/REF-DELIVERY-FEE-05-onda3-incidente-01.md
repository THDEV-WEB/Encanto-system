# INCIDENTE-01 — Aplicação acidental das migrations Onda 3.1/3.3 em produção

**Data:** 2026-09-06
**Severidade:** Alta (processo) / Nula (impacto funcional observado)
**Status:** Encerrado — produção restaurada, ferramenta corrigida

## Resumo

Durante a investigação de um bug de infraestrutura do PostgREST no ambiente E2E
(REF-DELIVERY-FEE-05 · Onda 3), descobriu-se que a ferramenta local de administração de
banco (`C:\Users\00thi\.encanto\run.mjs`) **ignorava silenciosamente o parâmetro `--env`**
e sempre conectava usando `db.env` (produção), independentemente de `--env db.e2e.env` ter
sido passado. Como resultado, uma quantidade significativa de trabalho desta sessão — que
deveria ter sido aplicada exclusivamente no projeto E2E (`bgzcrovskjbktdxkhemd`) — foi na
verdade executada contra o projeto de produção (`hvbcdxsagkjtfjwvnslo`).

## Causa raiz

Em `run.mjs`, a constante do caminho do arquivo de ambiente era hardcoded:

```js
const ENV_PATH = 'C:\\Users\\00thi\\.encanto\\db.env';
```

Não havia leitura de `process.argv` para um flag `--env`. A ferramenta nunca teve esse
parâmetro implementado — comandos como `node run.mjs --env db.e2e.env --file ...` eram
interpretados como se `--env` e `db.e2e.env` fossem argumentos desconhecidos e ignorados,
enquanto `--file <caminho>` era lido normalmente. `ENV_PATH` sempre apontava para `db.env`.

## Comandos afetados

Todos os comandos `node run.mjs --env db.e2e.env --file ...` executados ao longo da sessão
de investigação da Onda 3 (aproximadamente entre 2026-09-05 e 2026-09-06), incluindo:

- Aplicação das migrations `REF-DELIVERY-FEE-05-onda3-1-cache-tabela.sql`,
  `REF-DELIVERY-FEE-05-onda3-2-fix-nome-rpc-postgrest.sql` e
  `REF-DELIVERY-FEE-05-onda3-3-resolve-fee-cache.sql`.
- Testes de RLS/grants (tentativas de INSERT/SELECT por `anon`/`authenticated`, chamadas de
  RPC bloqueadas).
- Testes de cache (hit, miss, TTL expirado, isolamento cross-tenant) via `BEGIN...ROLLBACK`.
- Criação e remoção de funções triviais de diagnóstico (`teste_returns_void_diag`,
  `teste_returns_jsonb_diag`).
- Concessão e revogação de um `GRANT EXECUTE` temporário para `authenticated` na função de
  cache, para teste de hipótese.

**Não afetados** (confirmado): os scripts de teste de concorrência (`_temp_onda3_4_concorrencia.mjs`
e variantes) liam `db.e2e.env` diretamente via `readFileSync` próprio, sem depender de
`run.mjs` — esses genuinamente rodaram contra o E2E.

## Objetos criados/alterados em produção (não autorizado)

- Tabela `public.delivery_route_cache` (criada).
- Função `public._upsert_delivery_route_cache` (criada), depois renomeada para
  `public.upsert_delivery_route_cache`.
- Função `public._resolve_delivery_fee` (alterada para ler o cache antes do Haversine,
  adicionando o campo `distancia_fonte` ao retorno).
- Grant temporário de `EXECUTE` para `authenticated` na função de cache (concedido e
  revogado dentro de minutos, para teste de diagnóstico).
- Funções triviais de diagnóstico (criadas e removidas).

## Evidências de que não houve dano de dados

Confirmado por leitura, antes de qualquer ação de correção:

- `delivery_route_cache` tinha **0 linhas** — nenhum dado de teste persistido.
- **Nenhuma** loja com prefixo `teste-df05%`/`teste-concorrencia%` em `stores`.
- Grants da função de cache, no momento da checagem: só `postgres`/`service_role` (o grant
  temporário para `authenticated` já havia sido revertido).
- `create_order()` e `admin_orders_search()`: hashes **idênticos** antes e depois de todo o
  incidente (`9d356f21521519840fc7f9572191b6fc` e `f8af1611ef572b2fef1173200408d0f4`
  respectivamente) — nunca tocadas.
- `store_settings.delivery_fee_config` da loja real (Encanto) permaneceu com a tabela
  comercial oficial intacta, sem nenhuma alteração.
- A Edge Function `route-distance` **de produção nunca foi deployada** durante este
  trabalho — só a versão do projeto E2E foi alterada. Consequência prática: mesmo com o
  schema alterado, `delivery_route_cache` jamais teria sido populada em produção (nada
  gravava nela), então `_resolve_delivery_fee` sempre teria caído no fallback Haversine —
  **o comportamento de cálculo de taxa em produção nunca mudou na prática**, apesar do
  schema ter sido alterado sem autorização.

## Ações de contenção e rollback

1. **Snapshot read-only** do estado de produção antes de qualquer ação corretiva (schema,
   grants, RLS, índices, hashes de função, contagens de linhas/lojas).
2. Verificação de que nenhuma outra frente (MESA-01/MESA-02) havia feito alterações
   concorrentes sobre os mesmos objetos — confirmado negativo (hash de `create_order`
   nunca mudou ao longo de toda a investigação).
3. Rollback de `_resolve_delivery_fee()` para a versão anterior à Onda 3.3.
4. Rollback de `delivery_route_cache`/`upsert_delivery_route_cache` (Onda 3.1) — `DROP
   TABLE`/`DROP FUNCTION`, cobrindo ambos os nomes possíveis (com e sem underscore).
5. **Correção de fidelidade**: a primeira tentativa de rollback de `_resolve_delivery_fee`
   reproduziu a lógica original corretamente, mas havia sido escrita sem os comentários
   explicativos do texto real de produção — produzindo hash diferente
   (`57e84932d0cb9d9be57459401d0fb867`) do original (`b9509db21d3fe410e59253e2de1aa442`),
   apesar de comportamento idêntico. Corrigido aplicando o texto exato capturado na
   auditoria original desta REF (com os comentários), validado produzindo o hash
   original correto. O arquivo de rollback no repositório foi atualizado para refletir
   esse texto fiel.

## Validação pós-rollback

Confirmado por SQL read-only:

- `delivery_route_cache` não existe mais (`to_regclass` retorna `null`).
- `upsert_delivery_route_cache`/`_upsert_delivery_route_cache` não existem mais (0 funções).
- `_resolve_delivery_fee()`: hash `b9509db21d3fe410e59253e2de1aa442` — idêntico ao estado
  anterior a qualquer migration desta Onda 3.
- `create_order()`: hash `9d356f21521519840fc7f9572191b6fc` — inalterado durante todo o
  incidente.
- `admin_orders_search()`: hash `f8af1611ef572b2fef1173200408d0f4` — inalterado.
- Configuração comercial da Encanto real intacta.
- Nenhuma loja de teste residual.
- Contagens de `stores`/`orders`/`customers` sem indício de perda de dados.

## Teste funcional pós-rollback (sem criar pedidos reais)

Via `BEGIN...ROLLBACK` (transação descartável), chamando `_resolve_delivery_fee()`
diretamente com a config e coordenadas reais da Encanto:

- 5,7km → R$14,00 (caso de aceitação original da REF).
- 4,5km → R$12,00 (caso de aceitação original da REF).
- PIX → `adicional_pagamento_fee = 0`.
- Débito → `maquininha_fee = 2` e `adicional_pagamento_fee = 2`.
- Retirada → tudo zerado.
- Retorno **não contém mais** o campo `distancia_fonte` — prova de que a versão sem cache
  está de fato ativa, não apenas coincidência de valor.

## Prevenção futura

Ver correção obrigatória de `run.mjs` (seção seguinte) — o parâmetro `--env` agora é
respeitado de verdade, com um guardrail que aborta a execução se o projeto resolvido não
bater com o ambiente declarado.

## Lições

- Uma ferramenta que aceita um parâmetro sem de fato implementá-lo é mais perigosa que uma
  que rejeita o parâmetro — o silêncio passa confiança falsa.
- Hashes de definição de função (`pg_get_functiondef`) são sensíveis a comentários — uma
  reversão "funcionalmente equivalente" não é o mesmo que uma reversão fiel; ambas devem
  ser diferenciadas explicitamente ao validar um rollback.
- Scripts que fazem seu próprio parsing de arquivo de ambiente (em vez de depender de uma
  ferramenta compartilhada) acabaram sendo, por acidente, a parte do trabalho desta sessão
  que foi para o ambiente correto — reforça a importância de uma fonte única e confiável
  para resolver credenciais/ambiente.
