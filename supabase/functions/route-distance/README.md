# route-distance — Distância de rota viária (REF-DELIVERY-FEE-03)

Proxy server-side para o **OpenRouteService/HeiGIT Directions V2**. Esta Edge Function é o **único**
ponto do sistema que fala com o HeiGIT e o **único** lugar onde a chave da API vive.

## Por que uma Edge Function (e não chamada direta do navegador)

Diferente do Mapbox (token público restrito por domínio), a chave do OpenRouteService/HeiGIT **não
suporta restrição por domínio** — confirmado na documentação oficial e no próprio suporte do
provedor ("se você não quer expor ao usuário, mantenha no servidor"). Expor a chave no bundle do
cliente deixaria qualquer pessoa livre para copiá-la do DevTools e estourar a cota diária da conta
(2.000 requisições/dia no plano atual).

## Arquitetura do fluxo

```
checkout ──▶ routeDistanceService.calcularDistanciaEntrega(origem, destino)
                    │
                    ▼
          db.functions.invoke('route-distance')   (supabase-js, timeout 6s)
                    │
                    ▼
           route-distance (esta função) ──▶ cache em memória (hit/miss)
                    │ (miss)
                    ▼
      HeiGIT Directions V2 (driving-car, timeout 5s, sem retry)
```

Falha em qualquer ponto desta cadeia (função indisponível, timeout, HTTP 429/4xx/5xx, sem rota) →
resposta não-200 → o **cliente** (não esta função) cai no Haversine local e marca
`method:'haversine_fallback'`. Esta função nunca calcula Haversine — só sabe falar com o HeiGIT.

## Pré-requisito: conta OpenRouteService/HeiGIT

Já existe uma chave ativa (plano Standard gratuito: 2.000 requisições/dia, 40/min — Directions V2).

## Deploy

```bash
# 1) login (uma vez por máquina)
supabase login

# 2) linkar ao projeto (uma vez por checkout do repo)
supabase link --project-ref <PROJECT_REF>

# 3) segredo (ÚNICO ponto de credencial) — cole o valor real da chave, nunca versione este comando
supabase secrets set OPENROUTESERVICE_API_KEY="<cole a chave aqui, sem aspas extras>"

# 4) deploy da função
supabase functions deploy route-distance
```

## Comportamento sem credencial

Se `OPENROUTESERVICE_API_KEY` não existir, a função responde `503 {error:true, reason:"not_configured"}`
para toda requisição — o checkout cai no Haversine automaticamente (nunca quebra). Mesmo princípio já
usado em `whatsapp-notify` para as credenciais da Meta.

## Cache

Em memória (`Map`), por isolate — ver comentário de cabeçalho em `index.ts` e o espelho puro em
`src/services/delivery/routing/routeCache.js` (mesma lógica de chave/arredondamento, testada em
`tests/routeDistance.golden.mjs`). Chave sempre inclui `storeId`: nunca reaproveita rota calculada
para a loja A ao responder uma consulta da loja B, mesmo que origem/destino coincidam por acaso.

## Teste manual (local, com Supabase CLI + Docker)

```bash
supabase functions serve route-distance --no-verify-jwt --env-file .env.local
curl -X POST http://localhost:54321/functions/v1/route-distance \
  -H "Content-Type: application/json" \
  -d '{"storeId":null,"origin":{"lat":-26.850651757610454,"lng":-49.28720263609122},"destination":{"lat":-26.8959635,"lng":-49.2570131}}'
# -> {"distanceKm":10.4338,"durationMin":17.13...,"provider":"heigit","profile":"driving-car","cached":false}
```

## Teste manual (produção, após deploy)

```bash
curl -X POST https://<PROJECT_REF>.functions.supabase.co/route-distance \
  -H "Content-Type: application/json" -H "apikey: <anon key>" \
  -d '{"storeId":null,"origin":{"lat":-26.850651757610454,"lng":-49.28720263609122},"destination":{"lat":-26.8959635,"lng":-49.2570131}}'
```
