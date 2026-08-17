# REF-ADDRESS-AUTOCOMPLETE-01 — Auditoria e pesquisa técnica

Status: auditoria + decisão de provider + Fase 11 (testes de comportamento e multi-tenant) **concluídas**.
Proposta técnica final (rua/cidade homônima, UF nas sugestões, confidence) **entregue, aguardando
aprovação explícita** — nada aplicado. Nenhuma migration, UPDATE, deploy ou push realizados.

## Parte 2 — proposta final (não implementada)

### 1. Rua/cidade homônima — evidência real, não suposição

Testei ao vivo (3 chamadas reais, API pública do Photon, sem custo/chave):
- "Rua Itajaí" sem viés → Itajaí, Rio do Sul, Rio de Janeiro, Fortaleza, Fortaleza, Manaus (espalhado).
- "Rua Itajaí" com `lat/lon` = posição da Encanto (Timbó) → **Timbó**, Indaial, Pomerode, Apiúna,
  Blumenau, Blumenau (loja sobe pro topo sozinha).
- "Rua Itajaí, Indaial" com texto explícito + `lat/lon` ainda em Timbó → **Indaial** domina (3x),
  Itajaí depois — confirma que a correspondência textual vence o viés geográfico quando o usuário digita
  outra cidade.

**Proposta**: passar `companyInfo.lojaLat/lojaLng` como `bias.lat/bias.lng` pela mesma cadeia que já
carrega `bias.cidade/estado` (`useAddressSearch.js → geocodingService.js → waterfallGeocoder.js →
photonProvider.js`) — só `photonProvider.js` muda de fato (adiciona `&lat=&lon=` na URL quando
disponível). Sem viés (Bar da Sogra, hoje NULL) → comportamento nacional puro, idêntico ao atual. Nenhuma
camada de re-ranking própria é necessária — o Photon já resolve os 2 critérios de aceite nativamente.
Nominatim/Mapbox não precisam mudar agora.

### 2. UF nas sugestões — confirmado seguro

`sugestaoSub()` é pura, usada em 1 único lugar (`AddressSearch.jsx`). 2 dependências de teste
identificadas (`address.unit.mjs:111`, string exata; `address-autocomplete-scenarios.golden.mjs`, teste
que hoje documenta o gap) — nenhuma dependência arquitetural inesperada. Confirmado seguro para incluir.

### 3-4. Confidence — proposta exata (A–J) e modelo completo

Resumo (detalhe completo com tabelas no artifact publicado):
- CHECK atual: `CHECK (confidence IS NULL OR confidence = ANY (ARRAY['exact','street_level','approximate']))`.
- Novo proposto: `CHECK (confidence IS NULL OR confidence IN ('exact','street_level','neighborhood_level','city_level','unknown'))`.
- 0 das 19 linhas reais usa `'approximate'` — zero UPDATE necessário.
- **Achado novo, importante**: `confidenceValida()`/`enderecoValidoParaEntrega()` são validadores
  DORMENTES (nenhum fluxo real os chama, confirmado por busca) — risco de runtime da mudança é zero, só
  consistência de teste.
- **Achado arquitetural que muda o escopo recomendado**: `enderecoPlausivel.js` já exige `address.road`
  preenchido para QUALQUER resultado de busca sobreviver ao filtro de plausibilidade (Nominatim/Photon) —
  a mesma condição que já produz `street_level`/`exact`. Ou seja, **`neighborhood_level`/`city_level`
  nunca seriam produzidos pelo fluxo de sugestões de busca como está hoje** — só ficariam "vivos" se o
  filtro de plausibilidade (proteção da REF-DELIVERY-FEE-02 contra aceitar rio/POI como endereço) fosse
  deliberadamente relaxado, o que merece gate próprio, não deveria entrar nesta migration.
  `unknown` sozinho já resolve um problema real (GPS/mapa hoje deixam `confidence: null` sem classificar).

**Recomendação**: escopo enxuto (`exact, street_level, unknown`) agora; `neighborhood_level`/`city_level`
como decisão futura separada, condicionada a relaxar `enderecoPlausivel.js` de propósito. Escopo completo
(5 níveis) é a alternativa, aceitando que 2 deles ficam inertes por ora — decisão seu.

### 5. Drift store_id — registro formal

5 linhas (`addresses.store_id IS NULL`, de 19 totais) — todas rastreadas via `orders.endereco_id →
orders.store_id` a pedidos legítimos da Encanto, zero vazamento pra Bar da Sogra. Origem: RPC
`save_structured_address` nunca ganhou parâmetro `store_id`. Fora desta REF (é sobre busca, não sobre a
RPC de persistência multi-tenant) e exigiria UPDATE em produção, não autorizado. REF adequada proposta:
`REF-ADDRESS-STOREID-01` (adiciona `p_store_id` à RPC + `addressRepository.salvar()`; UPDATE único e
auditável nas linhas históricas usando o mesmo cruzamento já comprovado aqui). Nenhum UPDATE realizado.

### 6. Proposta final — 10 itens (detalhe completo no artifact)

1 (rua/cidade homônima) + 2 (UF) + 3 (modelo de confidence, decisão de escopo pendente) + 4 (migration
exata, só o CHECK) + 5 (impacto no código: ~6 arquivos) + 6 (impacto no banco: zero UPDATE) + 7 (testes:
4 arquivos a atualizar + casos novos) + 8 (riscos: baixos, plausibilidade intacta) + 9 (arquivos: 2
migrations + 6 código + 4 teste) + 10 (commits: 3 subfases — bias+UF primeiro, migration só após
aprovação, inferirConfidence+GPS/mapa por último).

**Nada implementado, testado ou commitado nesta etapa.** Processo: auditoria → decisão → **aprovação
(aguardando)** → implementação → testes → push → deploy → validação.

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

## Fechamento (2026-08-17) — implementado, publicado e validado em produção

**Escopo enxuto aprovado** (`exact`/`street_level`/`unknown`) implementado no commit `59968be`. Migration
aplicada em produção (`hvbcdxsagkjtfjwvnslo`) após pré-checagem: CHECK antigo
`IN ('exact','street_level','approximate')` → novo `IN ('exact','street_level','unknown')`; revalidação
das 22 linhas reais (21 `street_level` + 1 `exact`) sem nenhum `UPDATE`, confirmada antes e depois. 6
commits pushados (`dbd6447`→`59968be`), `origin/main` = `59968be7e989ceb3840a6cc3a6b9271f1bc520ba`. Deploy
Vercel `dpl_3oLdyikeaYw7o4xBM2UPFe5SDtGH` READY, alias de produção confirmado.

**Validação real pós-deploy** (bundle publicado + APIs reais, sem alterar dado nenhum):
- Bundle (`index-ClHTPlqy.js`) inspecionado: `inferirConfidence` minificado mostra literalmente
  `t.house_number?"exact":t.road?"street_level":"unknown"`; `sugestaoSub` mostra o `.join("/")`
  cidade/estado antes do separador `" · "`; guarda de sequência (`iniciar`/`aindaValido`) presente e
  ligada nos dois caminhos (sucesso e catch) de `searchAddress`; `approximate` = 0 ocorrências no bundle.
- Photon ao vivo com bias real da Encanto (`lat:-26.8506517576`, `lng:-49.2872026361`): "Rua João Schley"
  → 3 ruas de Timbó/SC; "Rua Itajaí" (rua homônima, sem cidade no texto) → Timbó no topo; "Rua Itajaí,
  Indaial" (cidade homônima, override textual) → Indaial domina o topo; sem bias (simulando loja nova
  tipo Bar da Sogra) → mesma URL de antes, degradação graciosa confirmada; query inexistente → 0
  features.
- Nominatim (3º da ordem) confirmado no ar (1 única requisição, respeitando a política de uso).
- Multi-tenant: `store_settings` de produção lido direto — Encanto tem `cidade/estado/lojaLat/lojaLng`
  preenchidos, Bar da Sogra não tem NENHUM desses campos (ausência real, não herança/NULL).
- Routing (REF-DELIVERY-FEE-03, não tocado por esta REF): `route-distance` re-testado contra a função
  publicada com as mesmas coordenadas do fechamento daquela REF (Timbó→Indaial) →
  `distanceKm:10.4338, durationMin:17.13, provider:heigit`, idêntico ao registrado; faixa de produção
  `10.1–11km → R$22` confirmada lida direto do `delivery_fee_config` real — sem regressão.
- Teste interestadual SC→MG (só leitura, nada alterado): geocoding real de "Praça Sete de Setembro, Belo
  Horizonte" (mesmo com bias em Timbó, o texto explícito da cidade venceu) → coordenadas reais
  `-19.919117,-43.9386465`; `route-distance` respondeu HTTP 200 com `distanceKm:1180.1781,
  durationMin:971.05` — nem o HeiGIT nem a Edge Function têm limite técnico de distância. O único
  "limite" é de negócio: `deliveryFeeRules.localizarFaixa` devolve `null` acima da maior faixa cadastrada
  (21km pra Encanto hoje) e `montarResumoFinanceiro` cai em `status:'fora_de_alcance'` — nunca bloqueia o
  pedido, taxa fica R$0 e a UI avisa "confirmamos o valor pelo WhatsApp" (comportamento pré-existente,
  não desta REF).

**Não testado ao vivo nesta rodada (limitação honesta)**: clique-a-clique real da UI no navegador
(AddressModal/Checkout) contra produção — evitado de propósito, pois um checkout real em produção criaria
pedido real. A cobertura equivalente vem de (a) inspeção do bundle publicado mostrando a lógica exata
implantada, (b) chamadas diretas às mesmas APIs que o código de produção chama, com os mesmos parâmetros,
e (c) as suítes automatizadas (`test:domain`, verdes antes do commit).

**Follow-ups registrados, fora desta REF**: `REF-ADDRESS-STOREID-01` (RPC `save_structured_address` sem
`p_store_id`, 5 linhas históricas com `store_id` NULL); `neighborhood_level`/`city_level` de confidence
(exigiriam relaxar `enderecoPlausivel.js` de propósito, gate próprio); cache de sugestões Photon/Nominatim;
`cached:true` do `route-distance` nunca observado em isolate novo (já registrado na REF-DELIVERY-FEE-03).

**STATUS FINAL: REF-ADDRESS-AUTOCOMPLETE-01 = FECHADA (2026-08-17).**
