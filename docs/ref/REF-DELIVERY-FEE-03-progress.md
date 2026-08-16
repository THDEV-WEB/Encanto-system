# REF-DELIVERY-FEE-03 — Distância viária (routing) para a taxa de entrega — progresso

Arquivo de retomada. Se a execução for interrompida, retomar EXCLUSIVAMENTE a partir daqui.

Análise/decisão original (Mapbox, não seguida) em
`docs/adr/REF-DELIVERY-FEE-03-modelo-distancia-viaria.md` — **superada**: o dono trocou o provedor
para **OpenRouteService/HeiGIT** (mensagem que reabriu a REF). Este arquivo é a fonte de verdade
atual.

## 1. Causa do problema original

`address/utils/coordinates.js:distanciaKm` (Haversine) mede distância em linha reta. Uma entrega real
percorre a malha viária. Caso de referência comprovado em produção (REF-DELIVERY-FEE-02, geocoding já
correto): Rua João Schley, 77 (Timbó/SC) → Rua Itajaí, 357 (Indaial/SC) — Haversine 5,861 km, taxa
R$12,00, enquanto a rota real observada no Google Maps ficava ~10-13 km.

## 2. Arquitetura anterior vs nova

**Antes:** `CheckoutPage.jsx` chamava `distanciaKm(coordLoja, coordCliente)` direto (síncrono, puro,
sem rede) e passava o resultado para `montarResumoFinanceiro`.

**Agora:**
```
CheckoutPage.jsx
    │ useEffect (async)
    ▼
routeDistanceService.calcularDistanciaEntrega(origem, destino)   [src/services/delivery/routing/]
    │ db.functions.invoke('route-distance', {timeout: 6000})
    ▼
route-distance (Supabase Edge Function, Deno)   [supabase/functions/route-distance/]
    │ cache em memória (hit/miss, chave tenant-safe) → miss →
    ▼
OpenRouteService/HeiGIT Directions V2 (driving-car, timeout 5000ms, sem retry)
```
Qualquer falha em qualquer ponto desta cadeia → o **cliente** (não a função) cai no Haversine local,
`method:'haversine_fallback'` — o checkout nunca bloqueia. `deliveryFeeRules.js`
(`localizarFaixa`/`montarResumoFinanceiro`) **não foi tocado**: continua puro, só consome um número de
km — não sabe nem precisa saber se veio de rota real ou fallback.

## 3. Decisão arquitetural que pausou a execução (resolvida)

Diferente do Mapbox (token público restrito por domínio), a chave do OpenRouteService/HeiGIT **não
suporta restrição por domínio** — confirmado na documentação oficial e no suporte do próprio
provedor ("se você não quer expor ao usuário, mantenha no servidor"). Chamar a API direto do
navegador (como o geocoding faz) exporia a chave a qualquer pessoa via DevTools, livre para esgotar a
cota diária.

**Decisão do dono (perguntada explicitamente):** Supabase Edge Function como proxy — reaproveita o
precedente já existente no projeto (`supabase/functions/whatsapp-notify`, REF-ORDER-01 Parte 3, hoje
dormente aguardando credenciais da Meta). A chave vive exclusivamente como Supabase secret
(`OPENROUTESERVICE_API_KEY`), nunca no bundle do cliente.

## 4. Teste real — Fase 2 (evidência, não simulada)

Script: `scripts/delivery-fee-03-heigit-smoke.mjs` (chamada direta ao HeiGIT, sem passar pela Edge
Function — usado só para provar o número antes de implementar). Executado em 2026-08-17:

| | Valor |
|---|---|
| Endpoint | `https://api.heigit.org/openrouteservice/v2/directions/driving-car` (novo; `api.openrouteservice.org` confirmado como legado/deprecated em favor deste) |
| Perfil | `driving-car` (não existe perfil de motocicleta na API; é o perfil correto para um veículo que usa a malha viária comum) |
| HTTP status | 200 OK |
| Latência (chamada direta, sem Edge Function) | 1141 ms |
| **Haversine** | **5,861 km** |
| **Rota real HeiGIT** | **10,434 km** (10.433,8 m) |
| Duração estimada | 17,1 min |
| Diferença | **+4,573 km / +78,0%** |
| Faixa Haversine (hoje, R$12,00) | 5,1–6,0 km |
| Faixa rota real | **10,1–11,0 km → R$22,00** |

Referência do Google Maps (~10-13 km, fornecida pelo dono, não reverificada de forma independente)
bate com o valor medido — tratada como referência aproximada, não como verdade absoluta (provedores
diferentes podem escolher rotas ligeiramente diferentes).

## 5. Modelo de distância escolhido

**Routing sempre (não híbrido D1 "só perto da fronteira")** — decisão implícita na arquitetura
implementada: como o cache já elimina a maioria das consultas repetidas (mesma loja + mesmo destino),
e o volume atual está bem abaixo da cota, não há necessidade de complicar a lógica com uma regra de
"só chama perto da fronteira de faixa" — que o próprio ADR anterior já havia identificado como
arriscada (o caso Timbó→Indaial tem Haversine no MEIO de uma faixa, longe de qualquer fronteira, e
mesmo assim errou a faixa por 2 posições — uma regra de fronteira teria deixado esse caso passar sem
correção).

## 6. Cache

Em memória (`Map` por isolate da Edge Function), TTL 30 dias, teto de 1000 entradas. Chave:
`storeId|origemLat,origemLng|destLat,destLng|perfil`, coordenadas arredondadas a 4 casas decimais
(~11m — junta "mesmo prédio", distingue endereços diferentes). **Tenant-safe por construção**:
`storeId` sempre entra na chave, mesmo que origem+destino já quase garantam unicidade por loja —
testado explicitamente (`tests/routeDistance.golden.mjs`: loja A e loja B com coordenadas idênticas
geram chaves diferentes).

Por que não uma tabela no banco: no volume atual (dezenas de pedidos/dia, 2 tenants, muito abaixo da
cota de 2.000/dia) uma migration + RLS só para cache de performance seria complexidade sem benefício
real — ver §8 (custo/escala) para o ponto de virada onde isso deixaria de ser verdade.

## 7. Fallback e tratamento de erro

Edge Function nunca calcula Haversine — só sabe falar com o HeiGIT e devolve HTTP não-200 com um
motivo identificável (`not_configured`, `rate_limit`, `heigit_erro_5xx`, `timeout`,
`rota_nao_encontrada`, `coordenadas_invalidas`) em qualquer falha. O **cliente**
(`routeDistanceService.js`) trata qualquer erro/timeout/resposta malformada de forma uniforme: cai no
Haversine local, `method:'haversine_fallback'` — nunca finge que foi rota real. `CheckoutPage.jsx`
registra um breadcrumb no Sentry (`method`, `provider`, `distanceKm`) a cada cálculo — observabilidade
de "por que essa distância" sem precisar de migration/persistência nova (ver §9).

## 8. Custo / escala

Cota atual: **2.000 requisições Directions/dia, 40/min** (conta HeiGIT, compartilhada por TODAS as
lojas do SaaS — uma única chave server-side, não por tenant).

| Lojas | Pedidos/dia/loja | Pedidos/dia (total) | % da cota diária SEM cache | Risco sem cache | % da cota COM cache (~50% hit estimado) |
|---|---|---|---|---|---|
| 2 | 10 | 20 | 1% | nenhum | <1% |
| 2 | 30 | 60 | 3% | nenhum | 2% |
| 2 | 100 | 200 | 10% | nenhum | 5% |
| 10 | 10 | 100 | 5% | nenhum | 3% |
| 10 | 30 | 300 | 15% | nenhum | 8% |
| 10 | 100 | 1.000 | 50% | baixo | 25% |
| 25 | 10 | 250 | 13% | nenhum | 6% |
| 25 | 30 | 750 | 38% | nenhum | 19% |
| 25 | 100 | 2.500 | **125%** | **estoura a cota** | 63% |
| 50 | 10 | 500 | 25% | nenhum | 13% |
| 50 | 30 | 1.500 | 75% | médio | 38% |
| 50 | 100 | 5.000 | **250%** | **estoura a cota** | 125% (estoura) |
| 100 | 10 | 1.000 | 50% | baixo | 25% |
| 100 | 30 | 3.000 | **150%** | **estoura a cota** | 75% |
| 100 | 100 | 10.000 | **500%** | **estoura a cota** | 250% (estoura) |

**Ponto de virada (sem cache):** a cota de 2.000/dia estoura em torno de **~2.000-2.500 pedidos de
entrega/dia somados de TODAS as lojas** — na escala atual (2 tenants, dezenas de pedidos/dia) isso
está **duas ordens de grandeza** longe. O cache empurra esse ponto para o dobro (~4.000-5.000
pedidos/dia), assumindo uma taxa de acerto conservadora de ~50% (endereços repetidos, mesma
loja/mesmo bairro) — hipótese razoável mas **não medida** (primeira medição real só depois de
produção rodando com tráfego real).

**Rate limit (40/min):** risco secundário — só relevante em picos de horário de almoço/jantar com
MUITOS tenants simultâneos; não é o gargalo principal na escala projetada.

**Recomendação:** revisitar esta REF (upgrade de plano HeiGIT, ou cache em tabela + TTL mais agressivo)
quando o volume agregado da plataforma se aproximar de ~1.500 pedidos de entrega/dia — bem antes de
estourar, com folga para agir.

## 9. Persistência (recomendação — SEM migration nesta REF)

Hoje `orders` não grava distância/método/provider — só `delivery_fee` (o valor em R$). Para responder
"por que este pedido cobrou R$24?" no futuro, seria necessário persistir `distancia_km`,
`distancia_metodo` (`rota`/`haversine_fallback`), `distancia_provider` (`heigit`/null) e
`duracao_min` no momento da criação do pedido (`buildOrderArgs`/`create_order`). **Não implementado
nesta REF** (fora do pedido explícito do dono) — hoje a única observabilidade é o breadcrumb do
Sentry no momento do cálculo (não sobrevive após o pedido ser criado). Se isso for necessário para
auditoria comercial, abrir uma sub-REF dedicada (migration em `orders` + `create_order` +
`admin_orders_search` + comanda).

## 10. Testes

`tests/routeDistance.golden.mjs` (novo, 20 casos, sem rede real — mocks determinísticos):
arredondamento/chave de cache, TTL, teto de tamanho, isolamento tenant-safe entre lojas, sem
coordenadas, sem cliente Supabase (modo degradado), sucesso da Edge Function, cache hit, erro HTTP,
rate limit, timeout, rota inexistente, distância não-finita, registro numérico do caso real (Fase 2).
Wired em `test:domain` (`npm run test:route-distance`).

`scripts/delivery-fee-03-heigit-smoke.mjs`: teste real isolado (chamada direta ao HeiGIT, fora da
suíte automatizada — não roda em CI, só sob demanda com a chave em `.env.local`).

## 11. Segurança da chave

`OPENROUTESERVICE_API_KEY` armazenada em `.env.local` (confirmado gitignorado via
`git check-ignore`), nunca impressa no terminal, nunca em código/documentação/commit. Varredura
explícita (`git grep`/`grep -r` pelo fingerprint da chave em todos os arquivos rastreados e novos)
confirmou zero ocorrências antes do commit. Único ponto de uso em produção: Supabase secret
consumido por `supabase/functions/route-distance/index.ts` — **deploy ainda pendente** (ver §14,
passo manual do dono).

## 12. Build / testes — resultado

- `npm run test:domain` (inclui `test:route-distance` novo) — **verde**, 0 falhas.
- `npm run build` (storefront) — **verde**, `CheckoutPage` compilado a 22,35 kB (era menor antes; cresceu
  pela nova camada de routing, dentro do esperado).
- `npm run build:admin` — **verde**, sem impacto (Admin não usa `routeDistanceService`).
- `npm run test:db-guards` — rodado (sem alteração de schema nesta REF, nenhuma migration criada).

## 13. Deploy (PENDENTE — passo manual do dono)

Este ambiente não tem sessão `supabase login` ativa (verificado: `SUPABASE_ACCESS_TOKEN` ausente) —
mesmo padrão já usado no projeto (migrations aplicadas manualmente pelo dono, nunca via DDL automático
de agente). Passos documentados em `supabase/functions/route-distance/README.md`:

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase secrets set OPENROUTESERVICE_API_KEY="<colar a chave real aqui>"
supabase functions deploy route-distance
```

Sem esse deploy, o checkout continua funcionando **exatamente como antes** (Edge Function inexistente
→ `db.functions.invoke` falha → fallback automático para Haversine, `method:'haversine_fallback'`) —
zero regressão, zero risco, só não ganha o benefício da rota real até o deploy acontecer.

## 14. Limitações conhecidas

- Cache em memória (não em tabela) — reseta em cold start do isolate; efetividade real só será
  observável após produção rodando com tráfego.
- Taxa de acerto de cache (~50%) é uma **estimativa**, não uma medição.
- Persistência de distância/método no pedido não implementada (§9) — auditoria "por que R$24" hoje só
  via Sentry, no momento do cálculo.
- Rate limit de 40/min não testado sob carga real (só avaliado teoricamente, §8).
- Latência da Edge Function (client → Supabase → HeiGIT → Supabase → client) não medida ainda — só a
  chamada direta (1141ms) foi medida; espera-se latência um pouco maior, sem número real até o deploy.

## 15. Próximos passos

1. Dono roda os 4 comandos do §13 (login/link/secret/deploy).
2. Smoke test pós-deploy: reabrir o checkout com o endereço real Timbó→Indaial, confirmar
   `delivery_fee` calculado a partir da faixa 10,1–11,0 km (R$22,00) — não mais R$12,00.
3. Confirmar no Sentry (breadcrumb) que `method:'rota'`/`provider:'heigit'` aparece nas primeiras
   entregas reais após o deploy.
4. Revisitar §8 quando o volume agregado se aproximar de ~1.500 pedidos/dia.

---

## RESUMO EXECUTIVO

```
DISTÂNCIA DE COBRANÇA = 10,434 km (medida real, Timbó→Indaial)
MÉTODO PRIMÁRIO       = rota (OpenRouteService/HeiGIT, Directions V2, perfil driving-car)
FALLBACK              = Haversine local (address/utils/coordinates.js), automático e transparente
TAXA DO CASO TIMBÓ → INDAIAL = R$22,00 (faixa 10,1–11,0 km) — era R$12,00 com Haversine
STATUS REF-DELIVERY-FEE-03 = IMPLEMENTADA E TESTADA LOCALMENTE, COMMIT PENDENTE DE AUTORIZAÇÃO,
                              DEPLOY DA EDGE FUNCTION PENDENTE (passo manual do dono, §13)
```
