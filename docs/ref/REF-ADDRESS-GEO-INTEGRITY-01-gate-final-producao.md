# REF-ADDRESS-GEO-INTEGRITY-01 — GATE FINAL DE PRODUÇÃO

Consolida as Ondas 2 e 3.

## STATUS: EXECUTADO EM PRODUÇÃO — 2026-08-31

Ambas as migrations foram aplicadas em produção e validadas. Ver **"Execução real"** no fim deste
documento para o registro completo (comandos, resultados, timestamps). Texto abaixo preservado como
o plano original que foi seguido à risca.

## Resumo executivo

Duas migrations, ambas `CREATE OR REPLACE FUNCTION` (sem mudança de schema), mitigam o achado da
Onda 1 (coordenadas de entrega manipuláveis) e corrigem o achado de ownership de `endereco_id`. O
ataque fino (coordenada fake dentro do raio real de entrega) **não é resolvido nesta etapa** —
permanece dívida documentada. Pré-check já executado (leitura): produção está exatamente na
versão-base esperada, seguro aplicar.

---

## 1. Migrations exatas que entrarão em produção

| # | Arquivo | Função alterada | O que faz |
|---|---|---|---|
| 1 | `migrations/REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1-bbox-delivery-fee.sql` | `_resolve_delivery_fee` | Bounding box de plausibilidade geográfica, isolado por tenant |
| 2 | `migrations/REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2-ownership-endereco.sql` | `create_order` | Ownership de `endereco_id` (só o próprio dono ou órfão) |

Rollbacks correspondentes já existem e commitados:
`REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1-bbox-delivery-fee-rollback.sql` e
`REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2-ownership-endereco-rollback.sql`.

## 2. Ordem obrigatória de aplicação

**Parte 1 (bbox) → Parte 2 (ownership).**

Não há dependência técnica estrita entre as duas (funções diferentes, `CREATE OR REPLACE`
independentes), mas a ordem reduz a janela de risco: a Parte 1 fecha primeiro o vetor **financeiro**
comprovado (o mais crítico — R$ indevido por pedido); a Parte 2 é hardening complementar
(autorização). Aplicar fora dessa ordem não quebra nada, mas não há razão para inverter.

## 3. Pré-checks necessários

Executados via `node scripts/address-geo-integrity-01-gate-final-precheck.mjs` (script novo, criado
nesta preparação, **já executado uma vez — resultado abaixo**; reexecutar imediatamente antes de
aplicar, para capturar qualquer mudança de última hora):

| Check | Resultado (2026-08-31) |
|---|---|
| `create_order()` em produção == byte-a-byte com `REF-DELIVERY-FEE-04-onda2-transparencia-valor.sql` | **PASS** |
| `_resolve_delivery_fee()` em produção == byte-a-byte com a definição original (Onda 1) | **PASS** |
| Grants: `create_order` EXECUTE para `anon`+`authenticated` | **PASS** |
| Grants: `_resolve_delivery_fee` SEM EXECUTE para `anon`/`authenticated` | **PASS** |
| Config real das lojas ativas (para validar o raio bbox) | `encanto`: maior faixa 21km → bbox 63km |

Adicionalmente, antes de aplicar:
- Confirmar que nenhuma migration nova tocou `create_order`/`_resolve_delivery_fee` desde este
  pré-check (`git log --oneline -- migrations/` — checar por commits de outras sessões).
- Confirmar working tree local limpo e os 6 commits desta REF presentes (`git log --oneline -6`).
- Preferir horário de baixo tráfego (a loja opera com poucos pedidos/hora, conforme já documentado
  em `REF-SEC-02`) — reduz o número de pedidos em voo durante a troca de função.

## 4. Backup / rollback

- **Antes de aplicar**: capturar `pg_get_functiondef` das duas funções e salvar como evidência do
  estado anterior (além do pré-check, que já confirma bytes idênticos aos arquivos-base já
  versionados — os arquivos `REF-DELIVERY-FEE-04-onda1.../onda2...` já SÃO o backup textual).
- **Rollback**: os 2 arquivos `-rollback.sql` restauram `CREATE OR REPLACE` para os corpos exatos
  anteriores — reversível a qualquer momento, sem downtime, sem restaurar snapshot de banco.
- **Sem mudança de schema**: nenhuma coluna, tabela, índice ou constraint é criada/alterada — só
  corpo de função. Isso significa que reverter depois de já haver pedidos reais criados sob a nova
  lógica é seguro: pedidos já persistidos não são recalculados retroativamente, o rollback só muda o
  comportamento daí para frente.
- **Critério de acionar rollback**: qualquer FAIL no smoke-test pós-deploy (item 8), qualquer erro
  inesperado observado em `application_logs` nos primeiros pedidos reais pós-deploy, ou qualquer
  reclamação de pedido legítimo rejeitado.

## 5. Funções / RPCs / views / triggers afetados

- `_resolve_delivery_fee(uuid, boolean, text, uuid)` — função interna, `SECURITY DEFINER`, sem
  `GRANT` a `anon`/`authenticated` (só chamável de dentro de `create_order`).
- `create_order(jsonb, jsonb, jsonb, uuid, uuid)` — RPC pública, `SECURITY DEFINER`, `GRANT` a
  `anon`+`authenticated`.
- **Nenhuma** view, trigger, tabela ou coluna nova.

## 6. Grants / RLS afetados

**Nenhum.** As duas migrations são puramente `CREATE OR REPLACE FUNCTION` — `CREATE OR REPLACE`
preserva o ACL existente da função (confirmado empiricamente nesta própria REF, ver `CO6` de
`address-onda6-orders-test.mjs`, que vigia exatamente isso desde a `REF-SAAS-01` Onda 4.1). Nenhuma
RLS policy é criada, alterada ou removida.

## 7. Validações pós-migration

1. Reexecutar `address-geo-integrity-01-gate-final-precheck.mjs` — agora as 2 primeiras linhas devem
   **PASSAR contra o conteúdo das migrations desta REF**, não mais contra as versões anteriores
   (ajustar o script para comparar com os novos arquivos antes de rodar, ou comparar manualmente via
   `pg_get_functiondef` — ver nota no rodapé do script).
2. Confirmar grants inalterados (mesmo script, seção de grants).
3. Rodar o smoke-test pós-deploy (item 8) — critério PASS/FAIL abaixo.
4. Confirmar que `NOTIFY pgrst, 'reload schema'` (já embutido nas migrations) surtiu efeito — um
   pedido real de smoke via API PostgREST (não incluído nas provas `BEGIN...ROLLBACK`, opcional) ou
   simplesmente aguardar alguns segundos (cache do PostgREST recarrega automaticamente no `NOTIFY`).

## 8. Provas `BEGIN...ROLLBACK` que serão executadas em produção

`node scripts/address-geo-integrity-01-gate-final-smoke.mjs` (script novo, criado nesta preparação,
**ainda não executado** — só depois que as migrations forem aplicadas, pois testa comportamento que
só existe depois delas). Uma única transação `BEGIN...ROLLBACK`, dados 100% descartáveis (loja X/Y,
produtos, customers, endereços — todos com `randomUUID()`, nunca a loja `encanto` real nem qualquer
dado real), reproduzindo as mesmas 10 asserções já validadas 10/10 no E2E
(`address-geo-integrity-01-onda3-integration-test.mjs`):

| # | Prova | Propriedades exercitadas |
|---|---|---|
| 1 | Customer D usa endereço de C + `delivery_fee` forjado → rejeitado, nenhum pedido | Ownership + delivery_fee autoritativo + divergência |
| 2a-2e | D usa o próprio endereço (dentro do bbox) + `price` forjado → pedido criado com valores corretos + 1 loyalty_event | Bounding box + ownership + preço autoritativo + fidelidade |
| 3a-3b | Retry do mesmo `request_id` → idempotente, sem duplicar | Idempotência |
| 4a-4b | Mesma distância relativa em loja Y (config diferente) + endereço de X usado em Y | Isolamento multi-tenant |

**Critério PASS**: 10/10 + linha final `"NAO (liquido zero confirmado)"`.
**Critério FAIL**: qualquer assertiva falha, ou `"SIM (FALHA GRAVE!)"` na verificação de líquido
zero → aciona rollback imediato (item 4).

## 9. Como provar ownership de `endereco_id`

Prova 1 do smoke-test (item 8): customer D, autenticado, tenta usar o `endereco_id` de outro
customer (C) — servidor nulifica o vínculo (`v_endereco_id := NULL`), o pedido não é criado nesta
tentativa porque a ausência de endereço faz o `delivery_fee` autoritativo cair para 0, divergindo do
valor forjado declarado (15,00) e disparando a rejeição de divergência (mecanismo diferente, mesmo
efeito protetor). Provas complementares equivalentes já cobertas 100% no E2E:
`address-geo-integrity-01-onda2-test.mjs` casos O8-O12 (próprio endereço, endereço de outro customer,
endereço de outra loja, guest com endereço órfão, guest tentando endereço de identificado).

## 10. Como provar bounding box

Prova 2a do smoke-test: coordenada dentro do raio (bbox = 63km para a config real da `encanto`)
calcula a faixa corretamente. Para provar a **rejeição** de coordenada grosseiramente implausível
(que a Prova 2 não exercita, por usar coordenadas legítimas), replicar isoladamente o caso `G2` de
`address-geo-integrity-01-onda2-test.mjs` (coordenada ~130km, config de teste com bbox=50km) — não
incluído no smoke-test de produção para não precisar inventar uma config de teste artificial ali;
já coberto 100% no E2E (`G1-G7`, 7/7).

## 11. Como provar delivery_fee autoritativo

Prova 2c do smoke-test: `delivery_fee` declarado corretamente (9,00) é persistido; Prova 1 mostra que
mesmo um valor forjado (15,00) nunca é persistido — o servidor sempre recalcula. Cobertura completa
equivalente já validada no E2E: `delivery-fee-04-onda1-test.mjs` (26/26, todos os casos de fee
forjado por cenário: retirada, maquininha ligada/desligada, perto/longe/fora-de-alcance, sem
endereço, endereço sem coordenadas, endereço de outra loja, cobrança desligada, isolamento).

## 12. Como provar isolamento multi-tenant

Provas 4a-4b do smoke-test: mesma distância relativa (~0,9km) resulta em taxas diferentes (R$9 em X,
R$40 em Y) porque cada loja usa sua própria config — e um endereço de X é rejeitado quando usado num
pedido de Y (bbox/ownership escopados a `store_id`). Complementado por `delivery-fee-04-onda1-test.mjs`
caso 12 (isolamento de config entre lojas) e `address-geo-integrity-01-onda2-test.mjs` G4a/G4b
(bbox isolado por tenant, mesma distância aceita numa loja e rejeitada — mas ainda dentro do bbox —
noutra).

## 13. Como provar que `price-source-01` e `delivery-fee-04` continuam intactas

Nenhuma das duas migrations desta REF toca `_resolve_item_pricing` (preço) nem a lógica de faixas/
Haversine/divergência de `_resolve_delivery_fee`/`create_order` além da inserção cirúrgica do bloco
de ownership. Evidência: as suítes dessas REFs rodam 100% verdes no E2E **depois** de aplicadas as
migrations desta REF lá — `price-source-01-onda1-test.mjs` (16/16), `price-source-01-onda2-test.mjs`
(15/15), `price-hardening-01-test.mjs` (14/14), `delivery-fee-04-onda1-test.mjs` (26/26),
`delivery-fee-04-onda2-test.mjs` (16/16, inclui a mecânica de divergência de valor),
`delivery-fee-04-onda3-test.mjs` (5/5, grants). Em produção, o próprio pré-check (item 3) já confirma
que o corpo de `create_order` antes da aplicação é byte-idêntico ao que essas REFs deixaram — a
mudança desta REF é estritamente aditiva (um bloco novo inserido, nada removido/alterado do que já
existia).

## 14. Como garantir líquido zero nos testes

- Toda prova (pré-check e smoke-test) roda dentro de **uma única transação `BEGIN...ROLLBACK`** —
  nunca há `COMMIT`.
- Todos os IDs (loja, produto, customer, endereço, pedido) são gerados com `randomUUID()` **dentro**
  da própria transação — nunca reutilizam ou tocam a loja `encanto` real nem qualquer customer/pedido
  real.
- O smoke-test verifica explicitamente, **depois** do `ROLLBACK`, que as lojas de teste não existem
  mais no banco (`SELECT count(*) FROM stores WHERE id IN (...)` deve ser 0) — se não for, o próprio
  script marca `fail++` e sai com código 1, mesmo que as 10 asserções internas tenham passado.
- Nenhum script desta preparação faz `COMMIT` em nenhum ponto do fluxo principal.

## 15. Riscos e limitações restantes

- **Ataque fino não resolvido** (deliberado, fora de escopo): coordenada fake que ainda cai dentro do
  raio real de entrega da loja continua não detectada. Documentado desde a Onda 2.
- **Mudança de contrato observável**: coordenadas grosseiramente implausíveis (bbox violado) agora
  fazem `create_order` retornar `ok:false` com uma mensagem nova (`"coordenadas de entrega
  implausiveis..."`) em vez de silenciosamente aceitar como R$0. Isso é uma mudança de comportamento
  para um caso que, na prática, só deveria ocorrer por manipulação deliberada — mas se o frontend não
  tratar esse `error` graciosamente (mesmo tratamento genérico que já usa para `divergencia_valor`),
  o cliente veria uma falha sem explicação clara. Recomenda-se checagem rápida do tratamento de erro
  genérico no `CheckoutPage.jsx` antes do deploy (fora do escopo desta REF alterar, mas vale
  confirmar que não quebra a UX).
- **Achados correlatos de outras REFs, não corrigidos** (Onda 3): `HARDEN-ORDERS-RLS-step2.sql`
  ausente no E2E, grants de `loyalty_grant` desatualizados no E2E, incompatibilidade `product_id`
  obrigatório vs. script legado, exceção crua de UUID malformado. Nenhum afeta produção — são gaps do
  ambiente de teste ou dívidas de outras REFs, documentados em
  `docs/ref/REF-ADDRESS-GEO-INTEGRITY-01-progress.md`.
- **Config real hoje cobre só 1 loja** (`encanto`, ativa e completa); `bar-da-sogra`/outras lojas
  sem `delivery_fee_config` completo não são afetadas pelo bbox (a função já retorna R$0 antes de
  chegar no cálculo de distância quando `ativo=false` ou faixas ausentes).
- **Dependência do pré-check**: se o pré-check (item 3) falhar na reexecução imediatamente antes de
  aplicar, **abortar o gate** e investigar a divergência antes de prosseguir — não aplicar a migration
  sobre uma base diferente da assumida (foi exatamente o incidente que ocorreu, e foi corrigido, na
  primeira tentativa da Parte 2 durante a Onda 2).

---

## Checklist de execução

1. [x] Reexecutar `address-geo-integrity-01-gate-final-precheck.mjs` — PASS em tudo.
2. [x] Aplicar `REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte1-bbox-delivery-fee.sql`.
3. [x] Aplicar `REF-ADDRESS-GEO-INTEGRITY-01-onda2-parte2-ownership-endereco.sql`.
4. [x] Rodar `address-geo-integrity-01-gate-final-smoke.mjs` — 10/10 + líquido zero.
5. [x] Confirmar `prosrc` das duas funções bate byte-a-byte com o conteúdo dos arquivos aplicados.
6. [x] Checar `application_logs` (módulo `orders`) — 0 linhas nos 30min da janela de aplicação.
7. [ ] Rollback — não acionado (nenhuma falha).

---

## Execução real — 2026-08-31

Ordem exata seguida, cada passo validado antes do próximo, nenhum atalho:

| Passo | Ação | Resultado |
|---|---|---|
| 1 | Pré-check (reexecutado imediatamente antes de aplicar) | PASS em tudo — base confirmada idêntica à assumida |
| 2 | Captura de baseline de `_resolve_item_pricing` (não tocada por esta REF, para comparação depois) | `prosrc` capturada, grants confirmados (`anon`/`authenticated` = false, ambos) |
| 3 | Aplicar Parte 1 (bbox) em produção | Aplicada sem erro |
| 4 | Validar Parte 1 | `_resolve_delivery_fee()` byte-a-byte com o arquivo aplicado; grants de `create_order`/`_resolve_delivery_fee` inalterados; `_resolve_item_pricing` idêntica à baseline |
| 5 | Aplicar Parte 2 (ownership) em produção | Aplicada sem erro |
| 6 | Validar Parte 2 | `create_order()` byte-a-byte com o arquivo aplicado; grants finais das 3 funções confirmados; `_resolve_delivery_fee` (Parte 1) confirmada intacta; `_resolve_item_pricing` confirmada intacta pela 2ª vez |
| 7 | Smoke-test completo (`BEGIN...ROLLBACK`, produção) | **10/10** — todas as propriedades confirmadas ao vivo (ver abaixo) |
| 8 | Checagem de `application_logs` (módulo `orders`, últimos 30min) | 0 linhas — nenhum erro real de pedido na janela |

### Resultado do smoke-test em produção (10/10)

```
PASS  1 — OWNERSHIP+DELIVERY_FEE+DIVERGENCIA: endereco de C rejeitado -> autoritativo=0 -> diverge, nenhum pedido
PASS  2a — BBOX+OWNERSHIP+DELIVERY_FEE: proprio endereco (dentro do bbox) aceito, delivery_fee=9.00
PASS  2b — endereco_id vinculado = o PROPRIO de D
PASS  2c — delivery_fee persistido = 9.00
PASS  2d — PRECO AUTORITATIVO: price forjado (0.01) ignorado, banco gravou 18.50
PASS  2e — FIDELIDADE: 0 na divergente, +1 na confirmada
PASS  3a — IDEMPOTENCIA: retry mesmo request_id -> idempotent:true, mesmo order_id
PASS  3b — IDEMPOTENCIA: retry NAO gera 2o loyalty_event
PASS  4a — ISOLAMENTO: config propria de Y cobra R$40 (nao R$9 de X)
PASS  4b — ISOLAMENTO: endereco de X em pedido de Y -> rejeitado, diverge

10 passaram, 0 falharam.
Verificacao pos-ROLLBACK: lojas de teste ainda existem no banco? NAO (liquido zero confirmado)
```

### price-source-01 / price-hardening-01 / delivery-fee-04 — confirmadas intactas

- `_resolve_item_pricing()` (usada por ambas REFs de preço): `prosrc` idêntica à baseline capturada
  **antes** de qualquer migration desta REF, confirmada em **2 momentos** (após Parte 1 e após Parte
  2) — prova direta e definitiva de que nada foi alterado nela.
- `_resolve_delivery_fee()`/lógica de divergência de `create_order()` (REF-DELIVERY-FEE-04): `prosrc`
  byte-a-byte com os arquivos aplicados — a única mudança é exatamente o bloco inserido por esta REF,
  nada mais.
- Exercitadas **ativamente** no smoke-test: prova 2d confirma `_resolve_item_pricing` recusando
  `price` forjado; provas 1/4b confirmam a mecânica de `divergencia_valor` (REF-DELIVERY-FEE-04 Onda
  2) funcionando exatamente como antes.

### Rollback

Não foi necessário acionar — nenhuma falha em nenhum passo. Os 2 arquivos `-rollback.sql` seguem
disponíveis e testados (usados no E2E) caso uma reversão seja necessária no futuro.

### Push / CI

**Não realizado nesta execução.** Seguindo a prática já estabelecida neste projeto (commits ficam
locais até pedido explícito de push), os commits desta REF permanecem locais. Avise se quiser que
eu empurre agora.
