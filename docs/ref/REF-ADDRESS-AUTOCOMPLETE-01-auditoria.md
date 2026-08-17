# REF-ADDRESS-AUTOCOMPLETE-01 — Auditoria e pesquisa técnica

Status: auditoria + decisão de provider + Fase 11 (testes de comportamento e multi-tenant) **concluídas**.
Gate de schema de confidence: **proposta pronta, aguardando aprovação explícita** — nada aplicado.
Nenhuma migration, UPDATE, deploy ou push realizados.

Relatório completo (com tabelas/formatação) publicado como artifact nesta sessão. Este arquivo é o
espelho textual no repositório, seguindo o mesmo padrão de `REF-DELIVERY-FEE-03-progress.md`.

## Fechamento da REF-DELIVERY-FEE-03 (contexto)

Distância viária real (HeiGIT/OpenRouteService Directions V2) substituiu Haversine. Edge Function
`route-distance` publicada e validada com o caso real Timbó→Indaial: 10,4338km, faixa 10,1-11km, taxa
R$22,00, fallback Haversine comprovado, checkout funcional. Ver `REF-DELIVERY-FEE-03-progress.md` e
memória `encanto-ref-delivery-fee-03.md` para o relatório completo dessa REF (fechada, não reaberta).

Achado incidental desta auditoria, relevante para o drift já conhecido: a RPC `save_structured_address`
(REF-ADDRESS-02) nunca foi atualizada para popular `store_id` depois que a coluna foi adicionada pela
REF-SAAS-01 · Onda 0 — qualquer endereço salvo desde então grava `store_id = NULL`. É a causa provável
das 2 linhas de drift. Registrado, **não corrigido agora**.

## Arquitetura atual (Fase 1)

Fluxo: `AddressSearch.jsx` (apresentacional) → `useAddressSearch.js` (motor de estado, debounce 450ms
via setTimeout, sem AbortController) → `geocodingService.js` (fachada) → `waterfallGeocoder.js`
(Mapbox dormente → Nominatim ativo → Photon ativo → gazetteer local como correção de última linha) →
seleção → tela própria de número/complemento/referência (`AddressDetalhesEntrega`, nunca aceita número
cego do provedor) → `AddressProvider` (fonte única, contexto+localStorage) → checkout →
`addressRepository.salvar()` (RPC `save_structured_address`) → tabela `addresses`.

Pontos fortes já existentes: waterfall com fallback real e testado (19 casos golden), filtro de
plausibilidade (`enderecoPlausivel.js`, rejeita rio/lago/POI/área geográfica pura — achado forense da
REF-DELIVERY-FEE-02), número sempre confirmado pelo usuário (nunca herdado cego do provedor), viés de
busca por cidade/estado já é por loja (multi-tenant correto desde REF-SAAS-01 · Onda 6.3), persistência
estruturada completa (rua/número/bairro/cidade/estado/CEP/lat/lng/provider/confidence).

## Gaps identificados

1. **Race condition real, sem teste**: debounce só com `setTimeout`, sem `AbortController` — resposta
   antiga pode sobrescrever resposta nova se a rede entregar fora de ordem.
2. **Nominatim no limite da própria política de uso**: a política oficial proíbe autocomplete
   client-side explicitamente. O debounce de 450ms mitiga hoje (não é por-tecla); qualquer evolução
   para type-ahead mais agressivo não pode aumentar a frequência de chamada a esse provedor.
3. **Confidence só tem 3 níveis** (`exact/street_level/approximate`) — pedido quer 5
   (house/street/neighborhood/city/unknown); "approximate" hoje mistura bairro/cidade/desconhecido.
4. **Sem cache de sugestões** (Photon/Mapbox); Nominatim já memoiza, os outros dois não.

## Pesquisa de providers (Fase 3) — dados verificados ao vivo

| Provider | Autocomplete | Número de casa (BR) | Chave | Limite | Custo |
|---|---|---|---|---|---|
| Nominatim (atual) | proibido por política | variável, não testado agora | nenhuma | 1 req/seg (oficial) | grátis |
| Photon (atual) | desenhado para isso | mesma base OSM, provável mesma esparsidade | nenhuma | "fair use" não documentado | grátis |
| Mapbox Geocoding v6 (já escolhido, dormente) | nativo, habilitado por padrão | boa cobertura documentada, não testado (sem token) | token público restrito por domínio — dispensa proxy | 100k grátis/mês (temp) | US$0,75/1k (temp) / US$5/1k (persistido) |
| HeiGIT/Pelias (testado ao vivo agora) | endpoint funciona, mas exclui camada `address` por padrão | **zero resultado** no endereço real testado | sem restrição de domínio, precisaria de Edge Function | 1000/dia (verificado, pool separado do Directions de 2000/dia) | já pago via free tier existente |

### Teste real HeiGIT/Pelias — achados verificados nesta sessão

- Endpoint real: `api.openrouteservice.org/geocode/{search,autocomplete}` — **não migrou** para
  `api.heigit.org` como o Directions fez. Mesmo header `Authorization`, mesma chave da conta.
- Quota confirmada via headers de resposta: `x-ratelimit-limit: 1000`/dia para Geocoding, pool
  **separado** dos 2000/dia do Directions — não compete com a REF-DELIVERY-FEE-03.
- Busquei o endereço-referência do projeto (Rua João Schley, 77, Timbó) pedindo explicitamente a
  camada `address` — resultado: só nível de rua, **nenhum dado de numeração**. `/autocomplete` exclui a
  camada `address` por padrão (aviso explícito da própria API: "performance optimization: excluding
  'address' layer").
- Armadilha de nomenclatura: `match_type:"exact"` no Pelias significa "bateu exato o que foi pedido
  naquele nível" (ex.: rua), não "sabemos o número da casa" — vocabulário diferente do `confidence`
  atual da Encanto, onde `'exact'` já significa "temos o número". Não confundir se este provider entrar.
- `accuracy:"centroid"` é honesto — a própria API já avisa quando a coordenada é só o centro
  aproximado da rua, mais explícito que o que Nominatim/Photon expõem hoje.

**Incidente operacional durante o teste** (registrado por transparência, não é achado técnico do
provider): um bug de sanitização no script de teste imprimiu a chave `OPENROUTESERVICE_API_KEY`
(URL-encoded) no terminal desta sessão — só ficou em disco local (transcript da sessão), nunca
commitada/enviada a lugar nenhum. Reportado ao dono na hora; tentativa de rotação resultou no mesmo
valor colado (comparação byte-a-byte confirmou identidade) — nenhuma rotação real ocorreu no dashboard
HeiGIT. O dono optou por manter a chave atual e seguir.

## Recomendação técnica preliminar

HeiGIT/Pelias **não é adequado como provider principal** de autocomplete residencial brasileiro: zero
dado de número de casa no endereço-referência do projeto, quota apertada (1000/dia) para uso por tecla,
exigiria a mesma Edge Function do routing (sem restrição de domínio na chave).

Mapbox já era o provider principal escolhido na REF-ADDRESS-02, dormente só por falta de token —
tecnicamente o mais forte (autocomplete nativo, token público restrito por domínio, sem proxy). Custo é
real, decisão do dono. Photon pode ganhar prioridade sobre Nominatim no waterfall para a parte mais
type-ahead, sem violar política de uso, mantendo Nominatim como fallback estrutural.

**Decisão pendente do dono**: ativar Mapbox (pago) vs. reordenar só o stack gratuito.

## Proposta de arquitetura, UX, número/confidence, waterfall, segurança, custo, testes, implementação

Detalhamento completo no artifact publicado (link na sessão) — resumo: mantém `address/` e
`useAddressSearch` como estão, adiciona `AbortController` (corrige a race condition, vale nos dois
cenários de provider), expande confidence para 5 níveis (`house/street/neighborhood/city/unknown`,
exige migration do `CHECK addresses_confidence_check`), fluxo sugestão→número→confirmação já existente
é reaproveitado sem mudança. 20 cenários de teste da Fase 11 mapeados contra a cobertura golden já
existente — maiores gaps: homônimos (rua/cidade), debounce/race condition, mobile, isolamento
multi-tenant ponta-a-ponta do autocomplete.

## Decisão do dono (2026-08-17) e implementação da parte segura

Stack gratuito, Photon > Nominatim, sem Mapbox/custo/chave nova. Implementado e commitado localmente
(push não pedido): reorder do waterfall + `searchGuard.js` (corrige race condition, 5 testes) —
commits `dbd6447` (auditoria) e `9492f40` (código+testes).

## Fase 11 — testes de comportamento (concluída, commit `19b3471`)

4 arquivos de teste (novos/expandidos), todos verdes, `test:domain` completo + 2 builds verdes:
- `address-autocomplete-scenarios.golden.mjs` (11 casos): rua homônima (achado — Photon ignora bias,
  Nominatim assume e prioriza quando Photon falha), cidade homônima (estado sempre presente no shape;
  gap documentado — `sugestaoSub()` não mostra estado na sub-label), número confirmado pelo provedor vs.
  digitado pelo usuário (confidence nunca "sobe" sem confirmação real), endereço inexistente, falha de
  provedor (Photon indisponível → Nominatim assume; ambos indisponíveis → `[]` sem lançar).
- `address-multitenant.golden.mjs` (6 casos), fundamentado em introspecção real (read-only) do banco:
  Encanto (`8604324d…`, cidade=Timbó/SC, lojaLat/lojaLng configurados) vs. Bar da Sogra (`776a01c8…`,
  todos os campos de `company_info` NULL — tenant novo, nunca configurado). Bias de busca, fallback do
  mapa (`CENTRO_PADRAO` = centro do Brasil, não a Encanto) e cache do Nominatim comprovadamente isolados
  por loja. `addressRepository.paraPayloadRpc` exportado (sem mudança de comportamento) para provar com
  a função REAL que o payload nunca inclui `store_id` — gap real: drift cresceu de 2 para 5 linhas desde
  a última medição, todas rastreadas (via `orders.endereco_id`) a pedidos legítimos da Encanto, **zero
  vazamento entre tenants** confirmado. Bar da Sogra tem 0 pedidos reais até agora.
- `address.guard.mjs` ganhou o invariante (13): nenhum arquivo de `address/` referencia
  `default_store_id()`.

## Gate de confidence — estado atual e proposta (NÃO aplicada)

**Produtores hoje**: `inferirConfidence()` (house_number→exact, road→street_level, nenhum→approximate);
`confirmCEP` hardcoda `'exact'` (bypassa inferirConfidence, ViaCEP nunca dá coordenada); GPS/mapa não
setam confidence (fica `null`). **Consumidores**: `confidenceValida`, `enderecoValidoParaEntrega`
(coords obrigatórias só se `exact`), aviso na UI (`AddressSearch.jsx`), RPC `save_structured_address`.
**Distribuição real** (19 linhas): 18 `street_level`, 1 `exact`, 0 `approximate`, 0 `NULL`.

**Proposta recomendada (opção A — estender, não renomear)**: manter `exact`/`street_level` como estão
(zero consumidor muda), retirar `approximate` (0 linhas reais usam), adicionar `neighborhood_level`/
`city_level`/`unknown`. Migration seria só `DROP`+`ADD CONSTRAINT` — revalida as 19 linhas existentes
sem precisar de nenhum `UPDATE` (confirmado pela distribuição real). `inferirConfidence()` precisaria de
2 ramos novos (checar `suburb/neighbourhood` e `city/town` separadamente) — a migration sozinha não
basta pra popular os níveis novos. SQL completo + análise de risco + lista de arquivos no artifact
publicado (link na sessão).

**Riscos**: baixo pro dado existente (nenhum UPDATE necessário); médio pro código (sem o `inferirConfidence`
novo, os 2 níveis extras nunca são gravados de verdade); `confirmCEP` continua com um hardcode
pré-existente questionável (`'exact'` sem coordenada) — não criado por esta migration, mas adjacente;
zero risco de RLS (confidence não participa de policy nenhuma).

**Pendente, precisa aprovação explícita antes de qualquer execução**: qual opção de schema (estender vs.
renomear), e só depois criar de fato o arquivo de migration + aplicar.

## Fora de escopo por instrução explícita

Drift de `store_id` em `addresses` (documentado, não corrigido) e `deliveryFeeRules.js`/`route-distance`/
taxa de entrega (REF-DELIVERY-FEE-03 fechada, domínios separados) — nenhum dos dois foi tocado.
