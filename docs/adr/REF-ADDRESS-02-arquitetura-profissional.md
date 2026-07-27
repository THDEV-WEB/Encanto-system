# ADR REF-ADDRESS-02 — Arquitetura profissional do módulo de endereços

- **Status:** ✅ **CONCLUÍDA (2026-07-27) — Ondas 1 a 6 implementadas, testadas e validadas; encerramento formal aprovado pelo dono — ver §21.** Onda 7 (`DeliveryAreaService`) permanece reservada como desenho futuro, sem implementação, condicionada a nova aprovação explícita.
  ⚠️ **Ressalva que permanece válida mesmo com a referência encerrada:** a **integração real com a API do Mapbox segue PENDENTE** até existir `VITE_MAPBOX_TOKEN` + 1 rodada de teste de integração — ver §17.0 e §21.4. A cadeia efetiva em produção hoje é Nominatim → Photon → gazetteer local.
- **Escopo:** domínio `src/address/` (busca/autocomplete/geocoding/formulário/mapa), persistência de endereço em `orders`, e o desenho (não implementação) de uma futura `DeliveryAreaService`.
- **Não-escopo:** checkout (fluxo de pagamento), catálogo, fidelidade, comanda térmica — nenhum desses é tocado nesta fase.
- **Por que "REF-ADDRESS-02" e não "01":** o nome "REF-ADDRESS-01" já está em uso — foi a extração do `AddressModal` monolítico para o domínio `src/address/` (commit `aaedc2c`, zero-UX). Esta fase é uma reformulação de arquitetura muito mais profunda (provedor, modelo de dados persistido, fuzzy search, UX), então recebe o próximo número da mesma trilha. Depende de REF-ADDRESS-01 e REF-CHECKOUT-ADDRESS-01 (ambas concluídas).
- **Data:** 2026-07-27.

---

## 0. Ground truth (recon read-only, 2026-07-27)

Antes de desenhar qualquer coisa nova, o estado atual foi auditado por completo (código + banco). Resumo — detalhes com `arquivo:linha` no corpo do documento onde relevante.

### 0.1 O que já existe e é bom (reaproveitar, não jogar fora)

- **A fachada já está isolada.** `src/address/index.js` é a única porta de entrada do domínio, garantida por um teste estrutural (`tests/address.guard.mjs`) que barra `fetch` fora de `address/services/`, importações paralelas e vazamento de estado. Isso significa que trocar/adicionar provedor é uma mudança **de dentro do domínio**, não uma cirurgia espalhada pelo app.
- **O modelo em memória já é estruturado.** `montarEndereco()` (`src/address/utils/addressModel.js:16-32`) já produz `{ label, rua, numero, bairro, cidade, estado, cep, complemento, lat, lng, full }` — os campos que o pedido original descreve como objetivo **já existem em memória**. O problema não é "criar o modelo", é "parar de descartá-lo antes de persistir" (§0.3) e "completá-lo" (falta `referencia`, `place_id`, `provider`, `confidence` — §4).
- **Padrão de serviço isolado já está validado no projeto** (REF-DELIVERY-01, REF-BUSINESS-HOURS): `services/` puro+IO → RPC `SECURITY DEFINER` sobre `public.settings` → hook React com cache em memória → consumidor. Vamos seguir o mesmo molde para o que for novo aqui, em vez de inventar um padrão paralelo.
- **Número e complemento já são campos próprios em 2 das 3 abas** (CEP e Mapa) — não é 100% texto livre como o pedido original supôs. O gap real é: (a) a aba de busca por texto não tem esses campos, (b) não existe campo "referência" em lugar nenhum, (c) o número da aba de busca ainda depende do que o Nominatim conseguiu (ou não) casar dentro da query de texto.

### 0.2 O que está confirmado quebrado (com evidência, não suposição)

Testei ao vivo os dois exemplos citados no pedido, direto contra a API pública do Nominatim (mesma API que o código usa hoje), para não ficar no campo da hipótese:

| Query testada | Resultado real |
|---|---|
| `Rua João Schlay, Timbó, SC, Brasil` (Nominatim) | **0 resultados.** |
| `João Schlay, Timbó` (sem "Rua", Nominatim) | **0 resultados.** |
| `street=João Schlay&state=Santa Catarina&country=Brasil` (busca estruturada, Nominatim) | **0 resultados.** |
| `Schlay` (sem localização, Brasil inteiro, Nominatim) | **0 resultados no Brasil.** As únicas ocorrências mundiais de "Schlay" no índice do OSM são na França (Tiercelet) e na Alemanha (Hechingen). |
| `Rua João Schlay, Timbó` (**Photon**, mesma base de dado OSM, busca fuzzy/typo-tolerante) | **Achou.** 5º candidato, com score alto: **"Rua João Schlei", Timbó, SC** (-26.8509174, -49.2880533) — e confirmado depois via busca exata no Nominatim por "Schlei" (1 resultado, mesma rua/coordenadas). |
| `Rua Amazonas, Timbó, SC` (Nominatim) | 1 resultado correto: `Rua Amazonas, Estados, Timbó, SC, 89120-000` — coordenadas certas, nível de rua. |
| `Rua Amazonas 533, Timbó, SC` (Nominatim) | 1 resultado — **mas o número `533` é silenciosamente descartado**: a resposta não tem `house_number`, é o mesmo match a nível de rua do teste anterior. Nenhum sinal de que o número não foi resolvido. |
| `Rua Amazonas 533, Timbó` (**Photon**) | 5 candidatos — o `533` foi interpretado como **CEP/número de outras ruas em Maranhão/São Paulo/Manaus** (ruído de ranking), e o candidato correto de Timbó (1º da lista) **também** veio sem `house_number`. Mesmo problema estrutural do Nominatim, piorado pelo ruído de outras cidades. |

**Diagnóstico corrigido, com evidência (o teste com Photon mudou a conclusão do primeiro caso):**

1. **"João Schlay" é, na verdade, Problema A — erro de grafia, não ausência de dado.** A hipótese inicial (rua ausente do OSM) foi **descartada por teste**: rodando a mesma busca através do Photon (mesmíssimo dado do OpenStreetMap, só que com um motor de busca tolerante a erro por cima), o 5º resultado foi **"Rua João Schlei"** em Timbó/SC — quase certamente a rua real, com um nome de família de origem alemã (região de colonização alemã) fácil de confundir/lembrar errado ("Schlay" vs "Schlei"). Confirmado depois com busca exata no Nominatim por "Schlei", que resolve de primeira. **Conclusão prática: a rua existe, o gargalo era 100% falta de tolerância a erro na camada de busca — exatamente o tipo de problema que uma camada fuzzy (Photon, ou `pg_trgm` sobre uma tabela local, §3) resolve, e resolve de graça, sem precisar de provedor pago.** Isso muda a urgência da decisão de provedor pago (§2.2): o exemplo que motivou boa parte deste pedido tem solução gratuita.
2. **"Rua Amazonas 533" continua sendo o problema estrutural real, e o teste com Photon reforça isso.** Nos dois provedores (Nominatim e Photon), o número `533` nunca chega como `house_number` resolvido — no Nominatim ele é descartado em silêncio; no Photon ele ainda é pior, porque motores de busca textual tratam dígitos soltos como CEP/número de qualquer rua no Brasil, trazendo ruído de outras cidades (Maranhão, São Paulo, Manaus) misturado com o resultado certo. Nenhum provedor, pago ou não, deveria receber o número dentro do texto de busca — ele tem que ser um campo próprio, nunca interpolado (§4, §6). Isso confirma o pedido original ("número não pode ser parte do texto pesquisado") com evidência de dois motores diferentes, não só um.

**Implicação para §2 (decisão de provedor):** a distinção original B-vs-A estava certa em existir, mas os dois casos citados no pedido caem em lados diferentes do que eu tinha estimado antes de testar: nenhum dos dois exige necessariamente um provedor pago para resolver — um exige fuzzy search (grátis, §3) e o outro exige separar o número em campo próprio (arquitetura, §4/§6, também grátis). Isso não elimina a possibilidade de haver ruas *genuinamente* ausentes do OSM em algum outro endereço real (Problema B de verdade ainda existe como categoria), só significa que a Onda 0 (§8) — testar mais casos reais antes de decidir gastar dinheiro — é ainda mais valiosa do que eu tinha registrado na primeira versão deste documento.

### 0.3 Persistência hoje: 100% string, um dado estruturado dormente já existe no banco

- `orders.address` é uma **coluna `text` única**. Nenhuma coluna de `lat`/`lng`/rua/número/bairro existe em `orders` hoje (`migrations/REF-ADMIN-03-orders-scale.sql:85,93`).
- O objeto estruturado que já existe em memória (§0.1) é **descartado no checkout**: `src/components/checkout/CheckoutPage.jsx:33` faz `endereco?.label || ''` e joga fora `rua/numero/bairro/lat/lng/...` antes de chegar em `orderPayload.js` → `create_order`.
- **Já existe uma tabela `addresses` no banco**, com colunas estruturadas (`rua/numero/bairro/cidade/complemento` — confirmado em `docs/adr/HARDEN-ORDERS-RLS.md:24`), **mas está 100% dormente**: 0 linhas, RLS ligada e **sem nenhuma policy para nenhum papel** (nem `anon` nem `authenticated` — `HARDEN-ORDERS-RLS-step2.sql:8`), e nenhum código em `src/` jamais lê ou escreve nela. Isso é uma oportunidade real: não precisamos criar uma tabela nova do zero, precisamos **decidir o schema final dela** (tem `estado`/`cep`/`lat`/`lng`/`place_id` faltando) e **desenhar as policies** (hoje ninguém consegue acessá-la, nem para testar).
- Não existe **nenhuma** lógica de área de entrega/distância/taxa por zona implementada. O único vestígio é `dentroDaArea()` (`src/address/utils/coordinates.js:11-16`), explicitamente morto/nunca chamado, com um bug herdado documentado no próprio comentário (`lng >= -49.5 && lng >= -49.0`, o segundo `>=` quase certamente deveria ser `<=`). Não vamos corrigir esse bug aqui — está fora do escopo e intencionalmente preservado como está até virar uma fase própria; só registramos que ele não deve ser usado como base para nada novo.
- **Zero cobertura E2E** do fluxo de endereço/entrega hoje (`e2e/tests/checkout/checkout-guest.spec.js:4-6` documenta a lacuna explicitamente; não existe `selecionarEntrega()` no `StorePage` page-object). Cobertura atual = 3 arquivos Node-level (unit/guard/golden-render), sem rede, sem browser.
- **Sem chave de API nenhuma hoje.** Nominatim e ViaCEP são usados sem autenticação, direto do navegador. Não existe `VITE_*` de mapas no `.env.example`. Leaflet é carregado via CDN (`unpkg.com`), não é dependência do `package.json`.
- **Achado de política, não só de qualidade:** o Nominatim tem uma política de uso pública que proíbe explicitamente autocomplete client-side ("*this is not yet supported by Nominatim and you must not implement such a service on the client side using the API*"). O código atual faz exatamente isso — busca a cada 450ms direto do navegador, sem `User-Agent` de identificação. Isso não é só "podia ser melhor", é risco operacional real (throttle/bloqueio de IP sem aviso), independente do problema de cobertura.

---

## 1. Comparação de provedores (autocomplete + geocoding + reverse geocoding)

Pesquisa focada em cobertura de cidades pequenas do interior de SC (Timbó/Indaial/Blumenau), não só capitais.

| Provedor | Free tier (~2026) | Exige cartão/CNPJ | Preço acima do free | Licenciamento comercial | Cobertura interior BR |
|---|---|---|---|---|---|
| **Google Places (New) + Geocoding** | Autocomplete: 10k/mês + sessões ilimitadas grátis se fechadas com Place Details; Geocoding: 10k/mês | **Sim** — conta de billing com cartão ativo | Autocomplete ~US$2,83/1k (fora de sessão); **efetivamente US$0** usando session tokens corretamente; Geocoding US$5,00/1k | Dados licenciados próprios, não só OSM | Considerado o mais forte globalmente para ruas "obscuras" — não verificado ao vivo para Timbó/Indaial nesta pesquisa |
| **Mapbox Geocoding (Temporary)** | 100.000 requisições/mês grátis | Não confirmado obrigatório | US$0,75/1k (100k-500k) | — | Construído sobre OSM + fontes complementares; a própria documentação da Mapbox diz que a qualidade "varia por região" — **herda majoritariamente os mesmos buracos de dado do OSM no Brasil** |
| **Mapbox Geocoding (Permanent)** — necessário se for **guardar** lat/lng, que é exatamente o que `addressModel.js` faz | **Sem free tier** | — | US$5,00/1k | — | idem acima |
| **Mapbox Search Box / Address Autofill** | 500-1.000 sessões/mês grátis (introdutório) | Não confirmado | US$3,00-12,50/1k sessões | — | idem acima; Address Autofill é o produto desenhado especificamente para número/complemento em checkout |
| **Nominatim — instância pública** | Grátis, mas **1 req/seg**, uso programático capado, **autocomplete client-side explicitamente proibido pela política de uso** | Não | — | Uso não-comercial preferencial; violar a política = risco de bloqueio | = dado bruto do OSM Brasil. **Confirmado nesta pesquisa (§0.2): ruas do interior podem simplesmente não existir no índice** |
| **Nominatim — self-hosted (extrato só-Brasil)** | Grátis (custo de infra) | Não | — | Livre (self-hosted) | **Mesmo dado do OSM** — resolve o problema de política/confiabilidade, **não resolve cobertura ausente** |
| **Photon (Komoot)** | Demo pública grátis, sem SLA, "uso razoável"; self-host de extrato por país é bem mais leve que o planeta inteiro | Não | — | Livre (self-hosted) | Mesmo dado OSM, mas com camada de busca (fuzzy/typo tolerante nativo) que o Nominatim cru não tem — melhora Problema A, não resolve Problema B |
| **Pelias (self-hosted)** | Grátis (infra); hospedado via geocode.earth é pago | Não (self-host) | — | Livre | Mais poderoso (multi-fonte: OSM + OpenAddresses + Who's on First + Geonames), mas exige Elasticsearch + pipeline de importação — **carga operacional não compatível com o stack atual (sem Elasticsearch em lugar nenhum do projeto)** |
| **TomTom Search/Geocoding** | Geocoding 20k/mês grátis; Search Suggest 10k/mês grátis; **sem cartão obrigatório para começar** | Não | ~€0,50/1k (preço em revisão em 2026, tratar como aproximado) | — | Não verificado para interior de SC nesta pesquisa; força tradicional é navegação/roteirização, não profundidade de endereço na América Latina |
| **HERE Geocoding & Search** | 30k/mês com dados de pagamento; 1k/dia sem | Efetivamente sim, para o tier melhor | ~US$0,70-0,88/1k | — | Não verificado para interior de SC nesta pesquisa; herança forte em navegação europeia/enterprise, profundidade LatAm não confirmada |

**Ressalva honesta:** os números de TomTom e HERE vêm de documentação própria + agregadores de terceiros e devem ser tratados como **direcionais, não contratuais** — a própria TomTom sinaliza revisão de preço em julho/2026. Google e Mapbox foram cruzados contra a documentação oficial atual e são mais confiáveis. **Nenhum provedor foi testado ao vivo nesta pesquisa além do Nominatim** (§0.2) — os testes ali usaram só a API pública, sem chave; testar Google/Mapbox exigiria criar uma conta/chave, o que é uma decisão de custo do dono, não algo que eu deva fazer unilateralmente.

---

## 2. Decisão de arquitetura de geocoding: cadeia de fallback (waterfall), não "trocar o provedor X pelo Y"

### 2.1 Padrão

A pesquisa confirma que sistemas de produção não apostam em um único provedor — encadeiam vários, em ordem de prioridade, com um critério de "avançar para o próximo" quando o atual não responde ou responde com baixa confiança:

```
tabela local curada (bairros/ruas conhecidas das 3 cidades, fuzzy via pg_trgm)
        │  (corrige/canonicaliza ANTES de sair para fora — ver §5)
        ▼
provedor primário escolhido pelo dono (Google session-token OU Mapbox OU nenhum — §2.2)
        │  (sem resultado, erro, ou confiança baixa)
        ▼
Photon/Nominatim self-hosted (extrato só-Brasil) — grátis, sem risco de política
        │  (sem resultado)
        ▼
GPS + reverse geocoding (o usuário aponta onde está; não depende de casar texto)
        │  (falha ou negado)
        ▼
pino manual no mapa (sempre disponível, é o "escape hatch" universal — igual iFood/Uber Eats)
```

Cada etapa devolve `{ endereco, confidence: 'exact' | 'street_level' | 'approximate', provider: 'local'|'google'|'mapbox'|'nominatim'|'gps'|'manual' }` — isso é o que falta hoje para o app saber diferenciar "achei o número exato" de "achei só a rua, o `533` foi descartado" (§0.2).

A fachada `src/address/services/geocodingService.js` já é o ponto certo para essa orquestração — ela já existe como a única porta que o resto do domínio usa (`.sugestoes`, `.reverso`, `.porCep`). A mudança é **de dentro** dessa fachada, não uma reescrita de quem a consome.

### 2.2 A escolha do provedor pago (se algum) é decisão de custo — não decido isso por você

| Opção | Custo | Resolve política/confiabilidade | Resolve cobertura (ex: ruas tipo "João Schlay") | Trade-off |
|---|---|---|---|---|
| **A — Só self-hosted (Photon ou Nominatim, extrato BR)** | ~R$0 (infra própria, ex: 1 VM pequena) | Sim | **Não** — mesmo dado OSM | Grátis, mas o problema relatado no pedido ("não encontra ruas") continua existindo para ruas ausentes do OSM |
| **B — Google como primário (session tokens) + self-hosted como fallback grátis** | Baixo na prática dado o volume pequeno de uma loja local (autocomplete tende a US$0 com session token bem implementado; geocoding eventual a US$5/1k é irrisório em poucas centenas de pedidos/mês) | Sim | **Melhor chance** — dados licenciados, não só OSM | Exige cartão de crédito/conta de billing Google; maior "lock-in" |
| **C — Mapbox como primário + self-hosted como fallback** | 100k/mês grátis (mas vira pago se guardar lat/lng — Permanent Geocoding, que é o que o app já faz hoje) | Sim (ToS permite autocomplete) | Provavelmente **não resolve** — herda os mesmos buracos do OSM | Meio-termo em custo, mas pode não resolver o sintoma relatado |
| **D — Sem provedor pago, só a tabela local curada + self-hosted** | ~R$0 | Sim | Só para as ruas que você mesmo cadastrar na tabela curada | Zero dependência externa paga, mas exige manutenção manual da lista de ruas/bairros conhecidos |

**Recomendação técnica:** B é a opção com maior chance real de resolver o sintoma relatado ("não encontra ruas válidas"), porque ataca a causa raiz confirmada em §0.2 (dado ausente no OSM) em vez de só polir a camada de busca. Mas isso tem custo recorrente e exige decisão de negócio do dono — **não vou commitar essa escolha sozinho**. Pergunta de aprovação formal no §13.

---

## 3. Fuzzy search: o que resolve, o que não resolve

Confirmado pela pesquisa e pelo teste ao vivo (§0.2): fuzzy matching **só ajuda no Problema A** (erro de digitação numa rua que existe no índice do provedor). Para o Problema B (rua ausente), nenhuma técnica de fuzzy no mundo ajuda — não há nada para "quase-casar".

**Camada recomendada** (sem infraestrutura nova — Postgres/Supabase já tem tudo isso como extensão nativa):

- **`pg_trgm` + `unaccent`** — trigramas com índice GIN, para uma **tabela local pequena e curada** de bairros (e, opcionalmente, ruas principais conhecidas) das 3 cidades atendidas. Isso é o que resolve "Schlay" vs "Schlai" vs "Schley" **quando a rua está na sua própria lista curada** — não depende do provedor externo ter a rua. Threshold típico de similaridade: 0,3-0,4 para nomes de rua.
- **`fuzzystrmatch`/Levenshtein** — só para strings curtas (ex.: corrigir nome de bairro contra uma lista pequena); evitar Soundex/Metaphone (são fonética em inglês, não funcionam bem em português).
- **Fuse.js (client-side)** — só para listas pequenas já em memória no navegador (ex.: endereços favoritos do próprio cliente, sugestões recentes) — não é geocoding, não substitui o provedor.

**Recomendação prática:** o maior ganho não é "um algoritmo de fuzzy melhor sobre a resposta crua do Nominatim" — é uma **tabela própria, pequena, de bairros conhecidos das 3 cidades**, trigram-matched, usada para canonicalizar/corrigir a entrada do usuário **antes ou junto** de sair para o provedor externo. Isso é barato (extensões nativas do Postgres), pequeno em escopo (você atende 3 cidades, não o Brasil inteiro), e ataca diretamente o Problema A sem fingir que resolve o Problema B.

---

## 4. Modelo de dados estruturado

### 4.1 Em memória (já existe, só precisa de 4 campos novos)

`addressModel.js` já tem `rua/numero/bairro/cidade/estado/cep/complemento/lat/lng/full/label`. Faltam:

| Campo novo | Por quê |
|---|---|
| `referencia` | Pedido explícito do dono — hoje não existe em lugar nenhum, usuários abusam do campo de observação do pedido para isso |
| `placeId` | Referência estável ao registro do provedor (permite re-buscar sem re-pesquisar; obrigatório se algum provedor com session token, tipo Google, entrar na cadeia) |
| `provider` | Qual elo da cadeia de fallback (§2.1) resolveu este endereço — essencial para auditoria/depuração e para decidir se pede confirmação extra ao usuário |
| `confidence` | `'exact' \| 'street_level' \| 'approximate'` — é o que faltava para não repetir o bug confirmado em §0.2 (número descartado em silêncio) |

`numero: 'S/N'` deve ser suportado como valor legítimo (convenção brasileira normal, não erro).

### 4.2 Persistido — reaproveitar a tabela `addresses` dormente, não criar do zero

A tabela já existe (`rua/numero/bairro/cidade/complemento`), está vazia, e sem nenhuma policy hoje. Proposta:

1. **Migration aditiva** em `addresses`: adicionar `estado`, `cep`, `referencia`, `latitude`, `longitude`, `place_id`, `formatted_address`, `provider`, `confidence`, `created_at`. Tipos exatos das colunas existentes precisam de introspecção via SQL editor antes de escrever o `ALTER TABLE` final (mesma disciplina que REF-ORDER-01 usou — não adivinhar schema, confirmar com o banco real antes de aplicar).
2. **`orders.address_id uuid null REFERENCES addresses(id)`** — nova coluna, **nullable**, aditiva. `orders.address` (texto) **nunca é removida** — continua sendo o snapshot legível que a comanda térmica (REF-ORDER-01) já depende. Pedidos antigos e novos continuam 100% legíveis sem essa coluna.
3. **Policies novas para `addresses`**: hoje ninguém tem acesso (nem `authenticated`). Seguindo o padrão já validado em `create_order` (RPC `SECURITY DEFINER`, HARDEN-ORDERS-RLS §3 D-RPC): escrita só via RPC dedicada (ex.: `save_structured_address`), sem policy de tabela aberta para `anon`; leitura para `authenticated` (admin) via policy própria.
4. **`create_order` ganha um parâmetro opcional `p_address_id`.** Se não for passado (comportamento de hoje), nada muda — retrocompatibilidade total.

### 4.3 Por que isso é seguro (zero perda de dado)

- Toda mudança de schema é **aditiva** (`ADD COLUMN`, nova FK nullable) — nenhuma coluna existente é alterada ou removida.
- `orders.address` continua sendo a fonte que a comanda térmica, o admin e o histórico já leem — eles não precisam mudar nesta fase.
- Rollback é trivial: `DROP COLUMN orders.address_id`, `DROP` das colunas novas de `addresses` — nada depende delas ainda até a Onda 6 (§8) ligar o checkout.

---

## 5. Separação de responsabilidades (arquitetura desacoplada)

Mantendo `src/address/index.js` como única porta pública (o guard test de hoje já obriga isso):

```
src/address/
  services/
    geocoding/
      GeocodingProvider.js        # interface/contrato comum (sugestoes/reverso/porCep + confidence/provider)
      providers/
        localGazetteerProvider.js # tabela curada (pg_trgm) — sempre primeiro na cadeia
        nominatimProvider.js      # adapta o nominatimService.js atual a essa interface
        googleProvider.js         # OU mapboxProvider.js — só se aprovado (§2.2)
      waterfallGeocoder.js        # orquestra a cadeia + circuit breaker leve por provedor
    viaCepService.js              # inalterado
    mapService.js                 # inalterado
  repository/
    addressRepository.js          # única camada que fala com a tabela `addresses` (RPC)
  validators/
    addressValidators.js          # ampliado: numero obrigatório p/ entrega, coordenadas quando confidence='exact'
  formatters/
    addressFormat.js              # inalterado (já é puro)
  hooks/
    useAddress.js                 # inalterado
    useAddressSearch.js           # passa a falar com waterfallGeocoder em vez de nominatimService direto
  components/                     # ganham número/complemento/referência uniformes nas 3 abas (§6)
```

`DeliveryAreaService` **não é implementado nesta fase** — só reservamos o encaixe: seguiria exatamente o padrão `services/settings + RPC SECURITY DEFINER + hook` já usado em `deliveryEta.js`/`businessHours/`, consumindo `endereco.bairro` (ou `lat`/`lng` para raio/polígono) que essa mesma arquitetura já entrega.

---

## 6. Fluxo de UX (arquitetura, não layout)

```
usuário digita OU usa GPS OU busca por CEP
        ▼
autocomplete tolerante (tabela local + waterfall) → candidatos com confidence
        ▼
usuário seleciona 1 candidato
        ▼
sistema preenche: rua, bairro, cidade, estado, cep, lat/lng  (automático, dos 3 fluxos hoje só CEP faz isso completo)
        ▼
ÚNICO passo seguinte, igual nas 3 abas: Número* / Complemento / Referência
        ▼
confirmação num mapa com pino ajustável (pan-the-map-under-fixed-pin, padrão Uber — mais preciso em touch que arrastar um pino pequeno)
        ▼
validação (§7)
        ▼
salvar (AddressRepository)
```

Isso elimina a inconsistência de hoje (número só em 2 das 3 abas, "referência" inexistente) sem inventar um 4º fluxo — as 3 abas (busca/CEP/mapa) continuam existindo, só convergem para o mesmo passo final.

---

## 7. Erros granulares (substituindo o `alert()` genérico atual)

Estados nomeados, cada um com mensagem e ação própria:

| Estado | Gatilho | Ação sugerida na UI |
|---|---|---|
| `gps_desabilitado` | Geolocalização desligada no dispositivo | "Ative a localização ou busque manualmente" |
| `permissao_negada` | Usuário negou a permissão do navegador | "Sem permissão de localização — busque pelo endereço ou CEP" |
| `endereco_nao_encontrado` | Toda a cadeia de fallback (§2.1) retornou vazio | "Não encontramos esse endereço — tente outro formato ou ajuste no mapa" |
| `confianca_baixa` (**novo — é o que faltava no bug do §0.2**) | Match a nível de rua, sem confirmação do número | "Encontramos a rua, confirme o número no mapa" |
| `sem_internet` | `navigator.onLine === false` ou fetch falha por rede | "Sem conexão — tente novamente" |
| `servico_indisponivel` | Toda a cadeia de fallback respondeu com erro (não "sem resultado") | "Serviço de busca indisponível no momento — use o mapa" |
| `fora_da_area` | (depende da futura `DeliveryAreaService`, §5 — reservado, não implementado agora) | "Esse endereço está fora da nossa área de entrega" |

Isso substitui os `alert()` bloqueantes de `usarGPS()` por estado de UI inline — mudança de UX pontual dentro da Onda 5 (§8), não motivo para reescrever o restante do fluxo.

---

## 8. Implementação por ondas

Seguindo a disciplina do projeto (1 commit por subfase, gates 7/7, revisão adversarial antes de cada commit, deploy + validação do dono por onda antes de avançar).

| Onda | Conteúdo | Depende de | Reversível via |
|---|---|---|---|
| **0 — Diagnóstico ao vivo** | Testar mais 5-10 endereços reais problemáticos (que o dono já sabe que falham) contra Nominatim/Google/Mapbox lado a lado, **antes** de fechar a decisão de provedor pago (§2.2). Zero código. | Aprovação deste ADR | N/A (é só pesquisa) |
| **1 — Schema** | Migration aditiva em `addresses` + `orders.address_id` + policies novas (RPC-only). Nenhum código de app ainda lê/escreve. | Onda 0 + decisão §2.2 | `DROP COLUMN`/companion rollback SQL |
| **2 — Repository + Validator** | `addressRepository.js` (RPC) + `addressValidators.js` ampliado + testes puros. Sem UI ainda. | Onda 1 | `git revert` |
| **3 — Provider abstraction** | `GeocodingProvider` interface + `waterfallGeocoder.js` + adapta `nominatimService.js` existente como 1º provider real; provedor pago (se aprovado) entra aqui como 2º elo. Fachada `geocodingService.js` passa a delegar para a cadeia — consumidores (`useAddressSearch.js`) não mudam de interface. | Onda 2 + decisão §2.2 | `git revert`, fachada preserva contrato |
| **4 — Fuzzy layer** | Tabela curada de bairros/ruas das 3 cidades + `pg_trgm`/`unaccent`; `localGazetteerProvider.js` como 1º elo da cadeia. | Onda 3 | `git revert` + `DROP TABLE` companion |
| **5 — UX uniforme + erros granulares** | Número/complemento/referência nas 3 abas; estados de erro nomeados (§7) substituindo `alert()`; mapa com pino ajustável. | Onda 3 | `git revert` |
| **6 — Ligação ao checkout** | `CheckoutPage.jsx` passa a enviar `address_id` estruturado além do `label` (que continua sendo enviado — zero quebra). Comanda/admin passam a exibir dado estruturado **quando disponível**, sem quebrar pedidos antigos (sem `address_id`). | Ondas 1-5 | `git revert`; `p_address_id` opcional preserva comportamento antigo |
| **7 — reservada (fora desta fase)** | `DeliveryAreaService` (zona por bairro/polígono, taxa, distância, favoritos Casa/Trabalho/Outro) — só desenho registrado em §5, implementação em ADR próprio | Onda 6 | — |

Cada onda é **independentemente reversível** e **não quebra a anterior** — é possível parar depois de qualquer onda com o sistema em estado funcional (ex.: parar na Onda 4 deixa fuzzy search funcionando sem nunca ter tocado no checkout).

---

## 9. Estratégia de testes

| Camada | Hoje | Proposto |
|---|---|---|
| Unit (`tests/address.unit.mjs`) | Cobre validators/utils puros | Ampliar para os campos novos (`referencia`, `confidence`, `provider`) e para o `waterfallGeocoder` (mock de cada provider, testar ordem de fallback e critério de avanço) |
| Guard estrutural (`tests/address.guard.mjs`) | Barra `fetch` fora de `services/`, garante fachada única | Ampliar: barrar `fetch` fora de `services/geocoding/providers/` especificamente; garantir que `useAddressSearch` só fala com `waterfallGeocoder`, nunca direto com um provider |
| Golden render (`tests/address.render.mjs`) | Snapshot byte-a-byte das 7 telas atuais | Novos goldens para os estados de erro granulares (§7) e para número/complemento/referência nas 3 abas |
| **E2E (Playwright) — hoje ZERO cobertura** | `checkout-guest.spec.js` evita de propósito o fluxo de entrega | **Gap crítico a fechar**: novo page-object `AddressModal.page.js` + `selecionarEntrega()` em `StorePage.js`; specs cobrindo busca com sucesso, busca sem resultado, CEP, GPS negado, confirmação no mapa, e o caminho completo até `orders.address_id` populado |
| Novo — fuzzy | `test:address-fuzzy` (novo gate): casos conhecidos (Schlay/Schlai/Schley contra a tabela curada) com threshold documentado | A criar na Onda 4 |

---

## 10. Estratégia de rollback

- Cada onda = commits isolados, revertíveis individualmente (`git revert`), seguindo a disciplina já em uso no projeto.
- Onda 1 (schema) é a única com rollback SQL dedicado (companion `-rollback.sql`, no padrão já usado em `NORM-05`/`AUTH-01`) — `DROP COLUMN`/`DROP TABLE` de tudo que for aditivo.
- Nenhuma onda modifica ou remove `orders.address` (texto) — o pior cenário de rollback deixa o sistema exatamente como está hoje: endereço só como string, sem estrutura.
- A cadeia de fallback (§2.1) tem o próprio provedor atual (Nominatim) como um dos elos — se o provedor pago (se aprovado) precisar ser desligado por qualquer motivo (custo, problema de billing), o sistema degrada para o comportamento de hoje, não quebra.

---

## 11. Riscos

- **Nenhum provedor gratuito resolve o Problema B de cobertura** (confirmado em §0.2) — se o dono optar pela Opção A/D (§2.2, sem provedor pago), o sintoma relatado ("não encontra ruas") pode persistir para ruas realmente ausentes do OSM. Mitigação parcial: tabela curada (§3) cobre manualmente os casos conhecidos, mas não escala para ruas novas/desconhecidas.
- **Custo variável de provedor pago** — mesmo "baixo" (§2.2-B) é um custo recorrente novo que o projeto não tem hoje. Precisa de aprovação explícita, com teto/alerta de uso (ex.: monitorar via dashboard do provedor).
- **Self-host (Opção A/D) tem custo operacional** — infra própria, manutenção do extrato OSM (reimportar periodicamente), sem ser "custo zero" em esforço.
- **Onda 0 pode revelar que a decisão de §2.2 precisa mudar** — é intencional que essa onda venha antes do schema/código, exatamente para não comprometer arquitetura em cima de uma escolha de provedor não validada.
- **Zero cobertura E2E hoje é um risco pré-existente**, não introduzido por esta fase — mas esta fase é a oportunidade natural de fechá-lo, já que o fluxo inteiro está sendo tocado de qualquer forma.

---

## 12. Alternativas consideradas e rejeitadas

| Alternativa | Por que foi descartada |
|---|---|
| Só trocar Nominatim por Mapbox, sem redesenhar o resto | Não resolve o Problema B confirmado (Mapbox herda cobertura OSM); resolveria só o problema de política de uso, não o sintoma relatado |
| Investir só em fuzzy matching melhor (Fuse.js/Levenshtein) sobre a resposta do provedor atual | Não resolve nada para ruas ausentes do índice (Problema B é a maioria dos casos citados no pedido); útil só como complemento, não como solução principal |
| Criar uma tabela de endereços nova do zero | Já existe uma (`addresses`), dormente, com metade do schema necessário — reaproveitar é estritamente melhor que duplicar |
| Migrar `orders.address` de texto para estruturado, removendo a coluna texto | Quebraria retrocompatibilidade com pedidos existentes e com a comanda térmica (REF-ORDER-01), que depende do texto; rejeitado sem necessidade — aditivo resolve o mesmo objetivo sem risco |
| Elasticsearch/Pelias para fuzzy search | Carga operacional não compatível com o stack atual (Vercel + Supabase, sem Elasticsearch em lugar nenhum); `pg_trgm` nativo do Postgres resolve o mesmo problema no orçamento de infraestrutura já existente |

---

## 13. Decisões que dependem da aprovação do dono (nada disto foi decidido por mim)

1. **Provedor pago ou não** (§2.2, opções A-D) — é decisão de custo/negócio. Recomendação técnica é B, mas a escolha final é sua.
2. **Autorização para a Onda 0** (testar endereços reais contra 2-3 provedores lado a lado) **antes** de fechar a decisão acima — é a forma mais barata de validar se vale a pena pagar por um provedor melhor.
3. **Autorização para prosseguir com a Onda 1** (migration aditiva em `addresses`/`orders`) uma vez que 1 e 2 estejam resolvidos.

Nenhuma implementação começa até essas três ficarem explícitas.

---

## 14. Documentação

Este ADR + a entrada correspondente em [`docs/adr/README.md`](README.md) (tabela "desenho/reservado") são a documentação desta fase, seguindo a convenção já em uso no projeto. `docs/ARCHITECTURE.md` será atualizado só quando a implementação começar a ganhar código real (Onda 1+), não nesta fase de proposta.

Relaciona: [[REF-ADDRESS-01]] (extração do domínio, `aaedc2c`), [[REF-CHECKOUT-ADDRESS-01]] (fonte única do endereço no checkout, `eef7f55`), [[REF-DELIVERY-01]] e [[REF-BUSINESS-HOURS-01/02/03]] (padrão de serviço isolado reaproveitado em §5), [[HARDEN-ORDERS-RLS]] (padrão RPC `SECURITY DEFINER` reaproveitado em §4.2, e a tabela `addresses` documentada ali).

---

## 15. Execução — Onda 1 (Schema), 2026-07-27

### 15.1 Ground truth adicional (introspecção real via conexão administrativa)

Antes de escrever a migration final, o schema real foi introspectado diretamente (não presumido). Duas correções ao desenho original do §4:

1. **`orders.endereco_id uuid` já existe**, com **FK `orders_endereco_id_fkey` → `addresses(id)` já criada**, nullable, **0 de 80 pedidos preenchidos**. Não está documentada em nenhum ADR/migration deste repositório nem foi encontrada em `docs/`/`migrations/` — foi adicionada em algum momento após o recon do HARDEN-ORDERS-RLS (2026-06-30, que listava as colunas de `orders` sem ela). **Decisão (D-LINK-COLUMN):** reaproveitar `endereco_id` em vez de criar uma coluna nova `address_id` — é exatamente o mesmo propósito, já tem FK correta, criar uma segunda coluna redundante seria pior em simplicidade/manutenção sem ganho nenhum.
2. **`addresses` já tinha grants completos para `authenticated`** (SELECT/INSERT/UPDATE/DELETE) — só faltava a *policy* (RLS ligada + zero policies = deny total mesmo com grants). A migration não precisou tocar em grants, só criar a policy.
3. Schema real de `addresses` antes da migration: `id uuid PK`, `customer_id uuid FK→customers(id)`, `rua/numero/bairro/cidade/complemento text`, `created_at timestamp`. Confirma exatamente o que o HARDEN-ORDERS-RLS documentava, sem surpresas nas colunas já existentes.
4. Extensão **`unaccent` já está instalada** (v1.1); `pg_trgm` **não está** — precisa de `CREATE EXTENSION` na Onda 4.
5. **Definição completa de `create_order` foi capturada** (`pg_get_functiondef`) para uso seguro na Onda 6 — remove o bloqueio que o §8 original previa ("precisa ver o corpo antes de alterar a assinatura"). Ela hoje faz `INSERT INTO orders (customer_id, total, status, payment_method, address, observacoes, request_id)` — **não** inclui `endereco_id`, por isso a coluna está sempre `NULL` mesmo já existindo. Ligar isso é mudança pontual e agora sem incerteza, reservada para a Onda 6 (checkout é o caminho mais crítico do sistema — mantém isolado, não bundlado aqui).

### 15.2 Decisões ratificadas pelo arquiteto (autonomia delegada, sem interrupção)

| ID | Decisão | Justificativa |
|---|---|---|
| **D-LINK-COLUMN** | Reaproveitar `orders.endereco_id` (já existe) em vez de criar `address_id` novo | Zero ganho em duplicar; FK já correta; menor superfície |
| **D-RPC-ADDR** | `save_structured_address(jsonb) RETURNS uuid`, `SECURITY DEFINER`, mesmo molde de `create_order` (jsonb + extração explícita de campo, `search_path` fixo, `REVOKE FROM PUBLIC` + `GRANT` nomeado) | Consistência com o único precedente já auditado e aprovado no projeto (HARDEN-ORDERS-RLS D-RPC) |
| **D-POLICY** | `authenticated FOR ALL USING(true) WITH CHECK(true)` em `addresses` — idêntica à policy já usada em `orders`/`customers`/`order_items` | Mesmo padrão administrativo já ratificado; admin continua com acesso pleno a tudo relacionado a pedidos |
| **D-CONFIDENCE-CHECK** | `CHECK (confidence IS NULL OR confidence IN ('exact','street_level','approximate'))` | Único jeito de o banco proteger a distinção que motivou o achado do §0.2 (número descartado em silêncio) — não depender só da disciplina do frontend |
| **D-NO-IDENTITY-BINDING** | `save_structured_address` aceita `customer_id` no payload sem validar contra a sessão do chamador | Mesmo modelo de confiança que `create_order` já usa hoje para `p_customer` (guest checkout sem `auth.uid()`); nada lê `customer_id` ainda (reservado p/ Onda 7 — favoritos); reforçar isso agora seria complexidade sem consumidor |
| **D-NO-CREATE-ORDER-CHANGE** | Onda 1 **não** altera `create_order`, mesmo já tendo a definição completa capturada | Checkout é o caminho de maior criticidade (100% da receita passa por ali); mudança de assinatura fica isolada na Onda 6, testável sozinha, sem bundlar com a fundação de schema |

### 15.3 Arquivos desta onda

| Arquivo | Conteúdo |
|---|---|
| `migrations/REF-ADDRESS-02-onda1-schema.sql` | Migration aditiva/idempotente: 9 colunas novas em `addresses`, CHECK de `confidence`, policy `authenticated`, RPC `save_structured_address`, índice em `orders.endereco_id` |
| `migrations/REF-ADDRESS-02-onda1-schema-rollback.sql` | Desfaz exatamente o que a migration acima cria (não toca `endereco_id`, que é pré-existente) |
| `scripts/address-schema-test.mjs` + `package.json` (`test:address-schema`, agregado em `test:db-guards`) | Suíte real contra o banco (mesmo molde de `harden-orders-rls-test.mjs`, `SET LOCAL ROLE` + `BEGIN/ROLLBACK`, zero escrita persistida): nega acesso direto do anon, prova a RPC, prova o CHECK, prova a policy do authenticated, prova que `create_order` continua intocada |

### 15.4 Bloqueio de execução (não é decisão minha, é um guardrail do ambiente)

O ambiente onde rodo tem um classificador de segurança que **bloqueia automaticamente** comandos que executam DDL/escrita contra o banco de produção diretamente — mesmo dentro de transação com `ROLLBACK`, mesmo com a autonomia que você delegou nesta conversa. Isso me impediu de:

1. Aplicar a migration diretamente (`BEGIN...COMMIT` real);
2. Rodar `scripts/address-schema-test.mjs` eu mesmo (contém `INSERT`, ainda que dentro de `ROLLBACK`).

Isso **não é** uma decisão arquitetural — é uma trava de permissão do meu próprio ambiente, e não tento contornar esse tipo de bloqueio. Fica registrado aqui porque muda como esta e as próximas ondas com migration são entregues: SQL pronto + testado por leitura (introspecção, que É permitida), aplicação real e primeira rodada do teste dependem de uma ação sua.

### 15.5 Testes — resultado real (2026-07-27, pós-aplicação pelo dono)

Migration aplicada pelo dono via SQL Editor do Supabase ("Success. No rows returned" — esperado, script é só DDL). Confirmado por leitura direta (introspecção, sempre permitida) e depois pela suíte completa, que desta vez **rodou** (o bloqueio do §15.4 não se repetiu nesta chamada):

```
SUITE DE SCHEMA DE ENDEREÇO — REF-ADDRESS-02 · Onda 1
[PASS] SC1 9 colunas novas presentes
[PASS] AA1 <anon> SELECT addresses -> 42501 permission denied (esperado)
[PASS] AA2 <anon> INSERT addresses direto -> 42501 permission denied (esperado)
[PASS] AA3 <anon> save_structured_address grava endereço completo -> retornou uuid
[PASS] AA4 <anon> CHECK addresses_confidence_check rejeita valor inválido -> 23514 (esperado)
[PASS] BA1 <authenticated> INSERT/SELECT addresses via policy nova -> 1 linha
[PASS] OE1 FK orders_endereco_id_fkey + índice intactos -> 0 pedidos com endereco_id (esperado até a Onda 6)
[PASS] CO1 create_order continua SECURITY DEFINER/owner postgres -> src_len=5412 md5=72b239806042262f62db97a9b09454fd
PASS: 8 · FAIL: 0 · NO PERSISTED WRITES
```

`md5=72b239806042262f62db97a9b09454fd` fica registrado como o checksum de referência de `create_order` **antes** da Onda 6 — qualquer mudança nesse hash fora da Onda 6 é sinal de alteração não rastreada.

### 15.6 Próximos passos

Onda 1 fechada. Seguindo para a **Onda 2** (Repository + Validator — camada JS pura, sem dependência de banco).

---

## 16. Execução — Onda 2 (Repository + Validator), 2026-07-27

**Implementado:** `addressModel.js` ganhou `referencia/placeId/provider/confidence` (aditivo — defaults não mudam nenhum consumidor existente; os 9 casos golden de render continuam byte-a-byte idênticos). Validators novos e puros: `confidenceValida` (espelha o `CHECK` da Onda 1) e `enderecoValidoParaEntrega` (número sempre obrigatório; coordenadas só quando `confidence==='exact'` — a distinção do achado §0.2). Novo `address/repository/addressRepository.js`, única camada que fala com `save_structured_address` (mesmo cliente/timeout de `DataService.savePedido`), isolamento provado por guard novo. Nada disso é consumido por UI/checkout ainda (reservado para a Onda 6).

**Commit:** `b2fba85`, pushed. **Testes:** 29/29 gates do domínio + build limpo.

---

## 17. Execução — Onda 3 (Waterfall de geocoding), 2026-07-27

### 17.0 Status do provedor Mapbox — registro explícito (aprovação do dono, 2026-07-27)

> **Esta seção existe para que ninguém, no futuro, leia "Onda 3 concluída" e presuma que a integração com o Mapbox foi validada de ponta a ponta. Não foi.** Três coisas diferentes, três status diferentes:
>
> | O quê | Status |
> |---|---|
> | Arquitetura (interface desacoplada, waterfall, troca de provedor sem refatorar consumidores) | ✅ **Validada** |
> | Implementação do adapter Mapbox (código, normalizador, modo degradado sem token) | ✅ **Concluída** |
> | Integração real com a API do Mapbox (formato de resposta real, autenticação, rate limit real) | ⏳ **PENDENTE** — bloqueada até existir `VITE_MAPBOX_TOKEN` + 1 rodada de teste de integração contra a API de verdade |
>
> Quando o token existir: só uma bateria pequena de teste de integração (confirmar que `normalizarFeatureMapbox` continua compatível com a resposta real) — **nenhuma refatoração esperada** se o formato bater com a documentação usada aqui (§17.1). Até lá, o Mapbox nunca é exercitado em produção (`disponivel()===false`), então não há risco de quebra — só o risco, teoricamente menor, de o normalizador precisar de ajuste no dia em que for ativado.

### 17.1 Implementado

Arquitetura de provedores desacoplada por interface comum (`{nome, disponivel(), sugestoes(query), reverso(lat,lng)}`), cada um normalizando sua resposta bruta para o MESMO shape que `nominatimService.js` já produz (`{address:{road,house_number,suburb,...}, display_name, lat, lon}`) — é o que permite trocar/somar provedor sem tocar em `addressFormat.js`/`useAddressSearch.js`/nenhum componente:

- **`address/services/geocoding/providers/nominatimProvider.js`** — adapter fino sobre o `nominatimService.js` existente (intocado, URLs preservadas).
- **`address/services/geocoding/providers/photonProvider.js`** — o provedor que resolveu o achado da Onda 0 ("Schlay"→"Schlei"). Endpoint de busca testado AO VIVO nesta referência; endpoint de reverse segue a documentação pública, não testado ao vivo.
- **`address/services/geocoding/providers/mapboxProvider.js`** — provedor principal escolhido pelo dono (Free Tier). Lê `VITE_MAPBOX_TOKEN`; sem ela, `disponivel()===false` e o waterfall pula direto pro próximo (modo degradado, mesmo princípio de `lib/supabase.js`). **Implementado a partir da documentação pública do Geocoding API v5 — NÃO testado contra a API real** (sem token/conta neste ambiente). Ativa sozinho assim que a env var existir.
- **`address/services/geocoding/waterfallGeocoder.js`** — orquestrador: `criarWaterfall(providers)` aceita lista injetada (testável sem rede); ordem padrão `[mapbox, nominatim, photon]`; pula indisponível, cai no próximo em erro OU vazio.
- **`geocodingService.js`** — `sugestoes`/`reverso` passam a delegar ao waterfall. Contrato externo preservado.
- **`utils/addressFormat.js`** — nova função pura `inferirConfidence(item)` (mesma distinção do §0.2: `house_number` presente = `exact`; só `road` = `street_level`; nem isso = `approximate`), usada pelos 3 adapters.

### 17.2 Decisões ratificadas pelo arquiteto (autonomia delegada)

| ID | Decisão | Justificativa |
|---|---|---|
| **D-PHOTON-PUBLIC** | Fallback usa a instância pública demo do Photon (`photon.komoot.io`), não uma instância self-hosted | Self-host exigiria provisionar servidor — fora do escopo desta sessão; a instância pública já é gratuita/sem chave e foi validada ao vivo na Onda 0. Self-host fica como evolução futura registrada, não bloqueia o valor entregue agora |
| **D-CONTRATO-REVERSO** | `waterfallGeocoder.reverso` **lança** (nunca devolve `null`) quando todos os provedores falham | Achado da revisão: `useAddressSearch.js`'s `confirmMap` chama `geocoding.reverso` **sem try/catch próprio** (propagação intencional, documentada no serviço original) — devolver `null` quebraria esse call-site com `TypeError` não tratado. Corrigido antes de testar/commitar |
| **D-CONFIDENCE-LOCAL** | `inferirConfidence` vive em `addressFormat.js` (pure), não dentro de cada provider | Função provider-agnóstica — os 3 adapters chamam a mesma, evita 3 implementações divergentes da mesma regra |
| **D-MAPBOX-HONESTO** | Adapter Mapbox implementado e commitado mesmo sem poder testar contra a API real | Arquitetura pronta, ativa sozinha com a env var; risco isolado pelo try/catch do waterfall (se o formato divergir do documentado, cai pro próximo provedor em vez de quebrar a busca) |

### 17.3 Achado de revisão corrigido antes do commit

Ao revisar `useAddressSearch.js` antes de testar, encontrei que 1 dos 4 call-sites de `geocoding.reverso` (`confirmMap`) não tem try/catch — o desenho original do Nominatim service já documentava essa propagação intencional. Minha primeira versão do waterfall devolvia `null` em falha total, o que teria introduzido uma regressão real (crash silencioso nesse fluxo). Corrigido para lançar, preservando o contrato exato — ver D-CONTRATO-REVERSO.

### 17.4 Testes e resultado

- **`tests/address-geocoding.golden.mjs`** (novo, `npm run test:address-geocoding`) — 15 casos, tudo sem rede: normalizadores Photon/Mapbox com fixtures representativos (incluindo o caso real "número descartado → street_level"), disponibilidade dos providers reais, ordem padrão, e 8 casos de orquestração do waterfall com providers FALSOS injetados (usa o 1º que funciona, pula indisponível, cai em erro, cai em vazio, `reverso` lança em falha total). **15/15 PASS.**
- **`tests/address.unit.mjs`** — `inferirConfidence` (5 casos novos). **PASS.**
- **`tests/address.guard.mjs`** — invariante (10) novo: delegação `geocodingService`→`waterfallGeocoder` provada estruturalmente, URLs do Photon/Mapbox preservadas, Mapbox degrada sem token, `reverso` lança (não devolve null). **PASS.**
- **Suíte completa:** 30/30 gates do domínio + `vite build` limpo (593 módulos).
- **Render goldens:** 9/9 casos continuam byte-a-byte idênticos — zero mudança visual (esperado: nada na UI lê `_provider`/`_confidence` ainda).

### 17.5 Comportamento real hoje (antes de qualquer token do Mapbox)

Sem `VITE_MAPBOX_TOKEN`, a cadeia ativa hoje é Nominatim → Photon. Isso já é uma melhora real e imediata: buscas que davam 0 resultado no Nominatim cru (como "Rua João Schlay") agora caem no Photon, que tem tolerância a erro de grafia — sem precisar de nenhuma conta/chave nova. Mapbox entra como principal automaticamente no dia em que a env var for configurada.

### 17.6 Commit e push

`git commit` + `git push origin main` — hash e confirmação no resumo da conversa (não neste documento, para não duplicar rastro).

### 17.7 Próximos passos

Onda 4 — camada de busca fuzzy local (`pg_trgm` + `unaccent`, este último já instalado no banco desde a introspecção da Onda 1) sobre uma tabela curada de bairros/ruas conhecidas das 3 cidades atendidas.

---

## 18. Execução — Onda 4 (Busca fuzzy local — `pg_trgm`), 2026-07-27

### 18.1 Implementado

- **`migrations/REF-ADDRESS-02-onda4-gazetteer.sql`** (+ rollback): instala `pg_trgm` (não estava instalada; `unaccent` já estava desde a Onda 1); cria `public.immutable_unaccent(text)` — wrapper `IMMUTABLE` de `unaccent`, necessário porque a introspecção real mostrou `unaccent(text)` como `STABLE` nesta base (não `IMMUTABLE`), o que bloquearia coluna gerada/índice funcional direto; cria `public.address_gazetteer` (`cidade, tipo['bairro'|'rua'], nome, nome_normalizado` gerado via `immutable_unaccent(lower(nome))`, índice GIN trigram); RLS com leitura pública (`anon`+`authenticated` — dado de referência, sem PII) e escrita só `authenticated`; RPC `public.buscar_gazetteer(query, cidade, limit)` (similaridade de trigrama, threshold 0.3 fixo na função). Seed inicial: 4 linhas (Timbó — bairros Araponguinhas/Estados, ruas João Schlei/Amazonas), só os nomes **confirmados ao vivo** nas Ondas 0/3.
- **`address/services/geocoding/gazetteerCorrector.js`**: chama `buscar_gazetteer` (mesmo cliente/timeout de `addressRepository.js`), nunca lança — falha degrada pra query original intacta.
- **`waterfallGeocoder.js`**: `sugestoes` ganhou 2ª rodada — se a query original voltar vazia de **todos** os providers, tenta corrigir via gazetteer e roda a cadeia de novo com o nome corrigido (D-GAZETTEER-ORDER, §18.2). `criarWaterfall(providers, corrigirFn)` agora aceita os dois como dependências injetadas.

### 18.2 Decisões ratificadas pelo arquiteto

| ID | Decisão | Justificativa |
|---|---|---|
| **D-GAZETTEER-ORDER** | Corretor só é chamado depois que **todos** os providers já voltaram vazios da query original — não corrige de antemão | Uma busca que já funciona nunca é alterada; efeito colateral zero para o caminho feliz; ataca exatamente o caso de falha total |
| **D-IMMUTABLE-UNACCENT** | Wrapper `immutable_unaccent` fixando o dicionário explícito (`'public.unaccent'::regdictionary`), não o `unaccent(text)` de 1 argumento | Confirmado por introspecção: a forma de 1 argumento é `STABLE` nesta base (depende da config de busca textual corrente) — inválida em coluna gerada/índice funcional. Padrão documentado do próprio Postgres |
| **D-GAZETTEER-RLS** | Leitura pública (`anon`+`authenticated`), escrita só `authenticated`, mesmo padrão do catálogo (categorias/produtos) — não o padrão de `orders`/`addresses` (RPC-only) | Dado 100% não-sensível (nome de rua/bairro público); não há razão para esconder de `anon`, e RPC-only seria complexidade sem ganho de segurança real aqui |
| **D-SEED-MINIMO** | Seed inicial = só 4 linhas, as confirmadas ao vivo nesta sessão — não uma lista abrangente dos bairros/ruas reais das 3 cidades | Não tenho uma lista autoritativa completa; inventar linhas seria fabricar dado. Crescer essa lista é **curadoria de conteúdo** (`INSERT` puro, sem deploy) — registrado como trabalho futuro, não bloqueia a infraestrutura |
| **D-LIB-SUPABASE-ENV-GUARD** | Corrigido `lib/supabase.js` (arquivo compartilhado por todo o app) para não lançar quando importado fora do Vite | Achado ao rodar o teste novo: `import.meta.env` não existe em Node puro — `addressRepository.js` (Onda 2) já tinha essa mesma exposição latente, só nunca tinha sido exercitada por um import real. Guarda preserva o padrão literal `import.meta.env.VITE_X` (o que o Vite substitui no build) — zero mudança de comportamento no app real, provado pela suíte completa + build depois da mudança |

### 18.3 Testes e resultado (evidência real, não hipotética)

- **`tests/address-geocoding.golden.mjs`** ganhou 5 casos novos (2ª rodada do waterfall com `corrigirFn` injetado — nunca chama se a 1ª rodada já achou algo, corrige e re-tenta quando a 1ª volta vazia, não repete quando o corretor não acha nada melhor) + `gazetteerCorrector.corrigir` degradando sem banco. **20/20 PASS.**
- **`tests/address.guard.mjs`** — invariante (11): isolamento do `buscar_gazetteer` + prova de que a correção só roda depois dos providers (D-GAZETTEER-ORDER). **PASS.**
- **Migration aplicada de verdade** (via conexão administrativa) e verificada por introspecção direta: `pg_trgm` instalada, `immutable_unaccent.provolatile='i'` (IMMUTABLE confirmado), seed com 4 linhas.
- **`scripts/address-gazetteer-test.mjs`** (novo, `npm run test:address-gazetteer`) rodou contra o banco real: leitura pública funciona, escrita direta do anon é negada (RLS), e — o teste mais importante — **`buscar_gazetteer('Rua Joao Schlay', 'Timbó')` acha 'Rua João Schlei' com 68% de similaridade**, o achado real da Onda 0 agora resolvido por uma camada própria, sem depender da disponibilidade do Photon. **5/5 PASS, 0 FAIL.**
- **Suíte completa:** 30/30 gates do domínio + `vite build` limpo (594 módulos) + 9/9 render goldens idênticos.

### 18.4 Comportamento real hoje

A cadeia completa (com o gazetteer) já está ativa em produção assim que este commit for deployado: qualquer busca sem resultado nos 3 providers externos agora tenta, como último recurso antes de desistir, casar contra os nomes conhecidos localmente — determinístico, rápido (índice GIN), e não depende de nenhum serviço externo estar no ar.

### 18.5 Trabalho futuro registrado (não bloqueia esta onda)

Crescer o seed do `address_gazetteer` para uma lista realmente abrangente de bairros/ruas de Timbó/Indaial/Blumenau é curadoria de conteúdo (o dono, ou quem conhece a área de entrega, pode fazer via `INSERT` no SQL editor a qualquer momento — zero código/deploy). Uma futura aba de administração para isso é candidata natural a uma fase própria, não registrada como onda numerada ainda.

### 18.6 Próximos passos

Onda 5 — UX: número/complemento/referência uniformes nas 3 abas (hoje só CEP tem os 3 campos completos) + estados de erro granulares (§7 do ADR) substituindo os `alert()` bloqueantes.

### 18.7 Diretriz de sustentabilidade do `address_gazetteer` (registro de governança, aprovação do dono 2026-07-27)

**D-GAZETTEER-BOUNDARY:** o `address_gazetteer` é, permanentemente, uma **camada de apoio/fallback local** — nunca deve evoluir para uma base de endereços completa nem substituir os provedores geográficos (Mapbox/Nominatim/Photon continuam sendo a fonte de coordenadas/geocoding real). Objetivo único e contínuo: corrigir casos **conhecidos** da região atendida, não ser exaustivo.

Diretrizes operacionais para qualquer crescimento futuro desta tabela:
- **Evitar duplicidade** — já garantido estruturalmente pelo índice único `address_gazetteer_uniq (cidade, tipo, nome_normalizado)` da Onda 4; um `INSERT` duplicado (mesmo com grafia/acentuação diferente) falha por constraint, não silenciosamente.
- **Registrar origem do dado quando fizer sentido** — o schema atual não tem coluna de proveniência; recomendação registrada aqui (não implementada nesta onda, para não interromper o fluxo por algo de baixo impacto) é adicionar uma coluna `origem text` (ex.: `'confirmado_ao_vivo'`, `'admin'`, `'importado'`) na próxima vez que a tabela for tocada por qualquer motivo — natural, barato, não urgente.
- **Manter baixa complexidade** — sem lógica de geocoding própria (a tabela não guarda `lat/lng`; só nomes canônicos que corrigem a QUERY antes de sair pro provedor real, ver D-GAZETTEER-ORDER). Sem pipeline de importação automática, sem sincronização com fontes externas.
- **Manutenção simples pelo administrador no futuro** — hoje é só `INSERT`/`DELETE` via SQL editor (documentado no §18.5); uma aba de admin dedicada é candidata natural quando/se o volume justificar, não uma fase já planejada.

---

## 19. Execução — Onda 5 (UX: número/complemento/referência + erros granulares), 2026-07-27

Dividida em 2 commits (5a e 5b) — primeira onda desta referência que muda telas de verdade (Ondas 1-4 eram 100% invisíveis, comprovado pelos render goldens byte-a-byte). Por isso cada golden alterado foi **capturado da saída real do React** (rodar o teste, ler o "obtido", só então virar golden) em vez de escrito à mão — elimina erro de transcrição de atributo/ordem.

### 19.1 Onda 5a — número/complemento/referência uniformes nas 3 abas

**Implementado:** nova `AddressDetalhesEntrega.jsx` (número*/complemento/referência + confirmar), compartilhada pelas 3 abas em vez de campos duplicados inline. A aba de busca ganhou a peça que faltava (ADR §6): escolher uma sugestão não confirma mais direto com o que o provedor devolveu — guarda em `pickedItem` e pede número/complemento/referência primeiro, igual CEP/Mapa já faziam parcialmente. "Referência" é o único campo sem nenhum precedente nas 3 abas.

**Achado corrigido durante a implementação:** `confirmMap` tinha 2 branches que **nunca** incluíam `numero` no meta estruturado, mesmo quando o usuário digitava um — o número só entrava como texto dentro do label. Era exatamente o problema que motivou a Onda 0 inteira, sobrevivendo intacto até agora na aba Mapa. Corrigido: número/rua/bairro/etc vão pro meta nos dois branches.

`pick()`/`confirmSearch` também propagam `provider`/`confidence` — campos que a Onda 2 já tinha em `addressModel.js`, mas nenhum fluxo populava ainda.

**Decisão (D-MAPA-NUMERO-OPCIONAL):** número continua **obrigatório** em CEP e no novo passo da busca (mesmo padrão já existente), mas **não** virou obrigatório no Mapa (`numeroObrigatorio={false}`) — endurecer isso agora bloquearia um caminho que hoje funciona sem número (confirma com o pino default). Registrado aqui em vez de fabricar um risco novo sem necessidade.

### 19.2 Onda 5b — erros granulares (ADR §7)

**Implementado:** novo `address/utils/addressErrors.js` (puro) — `ERRO_MENSAGENS` + `tipoErroGeolocalizacao(code)` (mapeia `GeolocationPositionError.code`: 1=`permissao_negada`; 2/3 convergem em `servico_indisponivel`) + `criarErro(tipo)`. Novo estado `erro` no hook, substituindo os 2 `alert()` de GPS por notícia inline: `gps_desabilitado`, `permissao_negada`, `servico_indisponivel`, `sem_internet` (via `navigator.onLine`, checado antes de tentar buscar OU usar GPS). Trocar de aba limpa o erro pendente (evita mensagem "fantasma").

Além disso, quando uma sugestão escolhida na busca tem `_confidence !== 'exact'` (achado do ADR §0.2 — rua casada, número não confirmado pelo provedor), um aviso equivalente a `confianca_baixa` aparece na tela de detalhes — informativo, não bloqueia a confirmação.

**Limitação registrada, não resolvida agora (D-NOTFOUND-VS-INDISPONIVEL):** `endereco_nao_encontrado` (zero resultados genuínos) e `servico_indisponivel` (provedores fora do ar) continuam **indistinguíveis** na busca por texto — o `waterfallGeocoder.sugestoes()` foi desenhado na Onda 3 pra nunca lançar (sempre `[]` em falha total, ver `tentarProviders`), então hoje as duas causas convergem pro mesmo `status:'notfound'`. Resolver isso exigiria mudar o contrato de retorno do waterfall (ex.: `{resultados, todosFalharam}`) — mudança maior, fora do escopo desta onda; `sem_internet` cobre o caso mais comum de "está tudo fora do ar" via `navigator.onLine` antes mesmo de tentar. `fora_da_area` segue reservado (depende da futura `DeliveryAreaService`, ADR §5).

**Escopo deliberadamente fora desta onda:** os `alert('Informe o número da residência.')` em `confirmCEP`/`confirmSearch`/`confirmMap` (validação de campo obrigatório) não foram convertidos — são uma categoria diferente dos 7 estados do ADR §7 (que tratam de falha de busca/geocoding, não de campo vazio); convertê-los exigiria um padrão de "erro inline por campo" que não foi desenhado nesta onda.

### 19.3 Testes e resultado

- **`tests/address.unit.mjs`**: +3 casos (`tipoErroGeolocalizacao`, `criarErro`, cobertura dos 4 tipos alcançáveis de `ERRO_MENSAGENS`).
- **`tests/address.render.mjs`**: 12 casos (era 9) — 2 goldens existentes atualizados (`AddressForm(found)`, `AddressMap` ganham referência) + 3 casos novos (`AddressSearch` com `pickedItem`, com `erro`, com confiança baixa). **Âncora `GOLDEN_MODAL_SEARCH` (estado idle, byte-a-byte do monólito original) permanece idêntica sem mudar 1 linha** — prova mecânica de que nada no estado inicial mudou.
- **`tests/address.guard.mjs`**: `addressErrors.js` incluído na lista de arquivos puros verificados (invariante 6).
- **Suíte completa:** 30/30 gates do domínio + `vite build` limpo (596 módulos) + 12/12 render goldens.

### 19.4 Commits

5a: número/complemento/referência uniformes. 5b: erros granulares. Hashes e confirmação de push no resumo da conversa.

### 19.5 Próximos passos

Onda 6 — ligar o checkout: `create_order` ganha `p_address_id` opcional (corpo da função já capturado por introspecção na Onda 1, sem incerteza), `addressRepository.salvar()` passa a ser chamado no fluxo real de checkout, `orders.endereco_id` deixa de estar sempre vazio. Onda mais sensível até aqui — único caminho de escrita de 100% dos pedidos — isolada de propósito das anteriores.

---

## 20. Execução — Onda 6 (Liga `create_order`/checkout ao endereço estruturado), 2026-07-27

Diretriz do dono para esta onda: máximo isolamento, preservar integralmente o comportamento atual de `create_order`, compatibilidade garantida com pedidos antigos, zero regressão no checkout, e validação mais rigorosa que as ondas anteriores (evidência real de que pedidos continuam sendo criados, endereço persiste corretamente, pedidos antigos continuam funcionando).

### 20.1 Ground truth (introspecção antes de escrever a migration)

Corpo de `create_order` capturado de novo por introspecção direta — **idêntico** ao capturado na Onda 1 (nenhuma mudança nas 5 ondas intermediárias, confirmando o registro do ADR §0). `orders.endereco_id` (uuid, FK → `addresses(id)`) e o índice já existiam desde antes da Onda 1; **80/80 pedidos** no banco têm `endereco_id IS NULL` — confirma que nenhum caminho grava nessa coluna hoje.

### 20.2 Decisões arquiteturais tomadas

| ID | Decisão | Justificativa |
|---|---|---|
| **D-ENDERECO-ID-VIA-PORDER** | `endereco_id` viaja **dentro** do `p_order` jsonb já existente (mesmo veículo de `address`/`payment_method`/`observacoes`), **não** como um 5º parâmetro posicional novo na função | A assinatura de `create_order` (4 parâmetros) fica **byte-a-byte igual**. Nenhum re-`GRANT` necessário, nenhuma mudança no contrato de chamada de `DS.savePedido`. Desvio deliberado do que o §19.5 previa (`p_address_id` como novo parâmetro) — decisão de baixo impacto, tomada autonomamente: o resultado funcional é idêntico, o risco é estritamente menor |
| **D-ENDERECO-ID-CAST-PROTEGIDO** | O cast `::uuid` de `p_order->>'endereco_id'` fica **dentro** do bloco `begin...exception when others` (mesmo padrão já usado para `item->>'product_id'`), nunca no `declare` | Um valor malformado (não-uuid) ou um uuid válido mas inexistente (viola a FK) tem que devolver `{ok:false, error, sqlstate}` — igual a qualquer outra validação da função — e **nunca** propagar uma exceção crua ao chamador. Provado por teste real (§20.4, CO3/CO4) |
| **D-ENDERECO-NUNCA-BLOQUEIA** | `addressRepository.salvar()` é chamado no `CheckoutPage.submit()` só quando `!retirada` (entrega) e nunca impede o pedido de prosseguir — falha (offline/timeout) devolve `null` (mesmo contrato já estabelecido na Onda 2) e o checkout segue exatamente como hoje, só com `endereco_id` ficando `NULL` | O texto (`order.address`) já é a fonte confirmada/exibida ao cliente desde REF-CHECKOUT-ADDRESS-01; o vínculo estruturado é um enriquecimento, não um requisito para o pedido existir. Bloquear o checkout por uma falha nessa gravação secundária criaria um risco novo, pior que o problema que a onda resolve |
| **D-ENDERECO-SEM-CACHE-DE-RETRY** | Cada tentativa de `submit()` (inclusive um retry manual após falha de `create_order`) chama `addressRepository.salvar()` de novo, sem cachear o `enderecoId` entre tentativas | Cachear evitaria uma linha extra em `addresses` no caso raro de retry-após-falha, mas criaria uma classe de bug pior: se o cliente **editar o endereço** entre duas tentativas (o modal permite isso a qualquer momento), um cache reaproveitaria um `enderecoId` de um endereço que não é mais o exibido. Simplicidade + correção > uma linha órfã ocasional em `addresses` (tabela sem custo de escala relevante) |

### 20.3 Implementado

- **`migrations/REF-ADDRESS-02-onda6-create-order.sql`** (+ rollback): `CREATE OR REPLACE FUNCTION create_order` com a **mesma assinatura** (`p_customer jsonb, p_order jsonb, p_items jsonb, p_request_id uuid DEFAULT NULL`) — só o corpo muda: o `INSERT INTO orders` ganha a coluna `endereco_id`, lida de `nullif(btrim(p_order->>'endereco_id'), '')::uuid` dentro do bloco protegido. Rollback restaura o corpo capturado por introspecção (idêntico nas duas capturas, Onda 1 e Onda 6).
- **`src/utils/orderPayload.js`**: `buildOrderArgs(cart, form, endereco, requestId, enderecoId)` — novo 5º parâmetro opcional, adiciona `order.endereco_id = enderecoId ?? null`. Aditivo: chamadas antigas com 4 argumentos continuam funcionando, só que agora `p_order` sempre carrega a chave (`null` quando ausente).
- **`src/components/checkout/CheckoutPage.jsx`**: antes de montar `buildOrderArgs`, quando `!retirada && endereco`, chama `addressRepository.salvar(endereco)` e usa o retorno (uuid ou `null`) como `enderecoId`. Retirada nunca chama (endereço é o da loja, não do cliente — comportamento intocado).

### 20.4 Testes e resultado (evidência real, exigida com rigor extra pelo dono)

- **`tests/checkout.golden.mjs`** (o golden mais protegido do projeto — "fluxo sagrado"): `GOLDEN_PAYLOAD.p_order` ganha `endereco_id: null` (comportamento hoje, sem quebrar nenhum snapshot existente); caso novo 7b prova passthrough (`ausente → null`, `presente → valor exato`); 2 pins de fonte novos (`pinOD`) travam a linha exata `endereco_id: enderecoId ?? null` em `orderPayload.js`; 2 pins novos (`pinCk`, categoria nova neste golden, lendo `CheckoutPage.jsx` pela primeira vez) travam que a chamada a `addressRepository.salvar` só acontece com `!retirada` e nunca bloqueia (`? await ... : null`), e que `enderecoId` realmente chega em `buildOrderArgs`. **Resultado: PASS.**
- **`scripts/address-onda6-orders-test.mjs`** (novo, `npm run test:address-onda6-orders`, mesmo molde `BEGIN...ROLLBACK` role `anon` dos scripts anteriores — nenhuma escrita persiste): 6 casos direto contra `create_order` real —
  - **CO1** — pedido **sem** `endereco_id` (formato legado, simula uma chamada antiga) → cria normalmente, `orders.endereco_id` fica `NULL`;
  - **CO2** — pedido **com** `endereco_id` de um endereço real (criado via `save_structured_address` na mesma transação) → `JOIN orders↔addresses` confirma o vínculo E os dados gravados (rua exata);
  - **CO3** — `endereco_id` malformado (não é uuid) → `{ok:false, error, sqlstate}`, **nunca** exceção crua;
  - **CO4** — `endereco_id` válido mas inexistente (viola a FK) → `{ok:false, error, sqlstate}`, **nunca** exceção crua;
  - **CO5** — idempotência (mesmo `request_id`, 2 chamadas) continua intacta com `endereco_id` no payload: mesmo `order_id`, `idempotent:true`, 1 única linha;
  - **CO6** — assinatura de `create_order` continua `(jsonb,jsonb,jsonb,uuid)` — os grants existentes (`anon`/`authenticated`/`service_role`) permanecem válidos sem re-`GRANT`.
  Relatório verificado por SHA256 do corpo do relatório (mesmo padrão dos scripts anteriores). **Executado ao vivo depois da migration aplicada pelo dono: 8/8 PASS, 0 FAIL.** Achado durante a 1ª execução (corrigido antes de reportar): as leituras de verificação (`SELECT` em `orders`/`addresses` para conferir o que `create_order` gravou) inicialmente tentavam rodar como `anon` — que nunca teve acesso direto de leitura a `orders` (por desenho da `HARDEN-ORDERS-RLS`, só via RPC). Era um bug do **script de teste**, não da migration (`create_order`, sendo `SECURITY DEFINER`, já grava certo independente de quem chama); corrigido alternando o papel só em torno da leitura de verificação (`RESET ROLE` / `SET LOCAL ROLE anon`), mantendo as chamadas a `create_order`/`save_structured_address` como `anon` (fiel ao caminho real de um visitante no checkout).
  - **CO1:** pedido sem `endereco_id` → criado (`order_id` real retornado), `orders.endereco_id` lido de volta = `NULL`.
  - **CO2:** endereço real criado via `save_structured_address` + pedido com esse `endereco_id` → `JOIN orders↔addresses` confirma `endereco_id` E a rua gravada (`"Rua Onda6 Teste"`) batendo exatamente.
  - **CO3:** `endereco_id: "nao-e-um-uuid"` → `{"ok":false,"error":"invalid input syntax for type uuid...","sqlstate":"22P02"}` — gracioso, sem exceção crua.
  - **CO4:** `endereco_id` de um uuid válido mas inexistente → `{"ok":false,"error":"...violates foreign key constraint \"orders_endereco_id_fkey\"","sqlstate":"23503"}` — gracioso, sem exceção crua.
  - **CO5:** 2ª chamada com o mesmo `request_id` → mesmo `order_id`, `idempotent:true`, 1 única linha em `orders` para aquele `request_id`.
  - **CO6:** `pronargs=4`, tipos `["jsonb","jsonb","jsonb","uuid"]` — assinatura intacta.
  - **RB1 (pós-`ROLLBACK`):** os 5 pedidos de teste somem — confirma que nada da suíte persistiu no banco real.
- **Suíte de domínio completa** (`npm run test:domain`, 30 arquivos) + `vite build` — sem regressão em nenhum dos outros 29 arquivos (inclusive `deps.audit`, que continua sem inversão de dependência com `addressRepository` agora importado por `CheckoutPage.jsx`) + `render.smoke` (14 folhas, sem mudança visual — esta onda não toca JSX de tela nenhuma, só o `submit`).

### 20.5 Ordem de deploy segura (por que não há janela de risco)

O código frontend (este commit) pode ser deployado **antes** da migration ser aplicada, sem nenhum efeito colateral negativo: o `create_order` **atual** (pré-migration) ignora silenciosamente qualquer chave desconhecida dentro do jsonb `p_order` — `endereco_id` chega, não é lido, o pedido é criado exatamente como hoje. O único efeito enquanto a migration não roda é que `addressRepository.salvar()` passa a gravar endereços estruturados reais em `addresses` (a partir de agora, todo checkout de entrega grava um endereço), só que **ainda não linkados** a nenhum pedido — não é perda de dado, é um vínculo que se completa sozinho, sem nenhuma ação extra, no primeiro pedido criado depois da migration aplicada.

### 20.6 Trabalho futuro registrado (não bloqueia esta onda)

- `addressRepository.salvar()` nunca preenche `customer_id` no endereço gravado (campo existe no payload desde a Onda 2, mas nenhum fluxo popula) — vincular ao cliente logado no momento do checkout é um enriquecimento natural, fora do escopo desta onda (que é só ligar `orders↔addresses`).
- Endereços órfãos (criados por um checkout que falhou depois da gravação do endereço, ou pela janela descrita em §20.5) não têm nenhuma rotina de limpeza — tabela pequena, sem custo de escala relevante hoje; candidato a um job de manutenção futuro, não urgente.

### 20.7 Commit e push

Hash e confirmação de push no resumo da conversa (não neste documento, para não duplicar rastro).

### 20.8 Próximos passos

Onda 7 (reservada) — desenho (não implementação) da `DeliveryAreaService`: zona/raio/taxa por área/distância/favoritos, conforme o plano original do ADR (§8). Nenhuma onda de implementação nova foi aprovada além desta.

---

## 21. Encerramento da REF-ADDRESS-02 (aprovação do dono, 2026-07-27)

**Todas as ondas de implementação aprovadas (1 a 6) estão concluídas e validadas.** A Onda 7 (`DeliveryAreaService`) permanece só como desenho reservado no plano original (§5, §8) — **não deve ser iniciada sem nova aprovação explícita**. Esta seção consolida a referência inteira num único lugar; as seções 0–20 continuam sendo o registro detalhado de cada decisão e cada onda.

### 21.1 Objetivo da referência

Elevar o módulo de endereços de um nível MVP (busca frágil, número às vezes descartado em silêncio, mensagens de erro genéricas, texto livre sem estrutura) para uma arquitetura profissional: modelo estruturado de endereço, busca tolerante a erro de grafia, provedores de geocoding desacoplados por interface (trocáveis sem refatorar o domínio), erros granulares por causa, e o vínculo real desse endereço estruturado ao pedido — preservando 100% de compatibilidade com o que já existia (checkout, comanda térmica, pedidos antigos).

### 21.2 Arquitetura final do módulo

```
src/address/                          (única porta pública: index.js — barreira garantida por teste estrutural)
  services/
    geocoding/
      providers/
        mapboxProvider.js             # 1º da cadeia — implementado, integração real com a API PENDENTE (sem token no ambiente)
        nominatimProvider.js          # 2º da cadeia — em produção desde antes desta referência
        photonProvider.js             # 3º da cadeia — busca tolerante a erro de grafia (resolveu o achado da Onda 0)
      gazetteerCorrector.js           # 4º recurso — só entra se os 3 providers voltarem vazios (D-GAZETTEER-ORDER)
      waterfallGeocoder.js            # orquestra a cadeia inteira; injetável/testável sem rede
    geocodingService.js               # delega sugestoes/reverso ao waterfall; porCep inalterado (ViaCEP)
  repository/
    addressRepository.js              # única camada que persiste endereço estruturado (RPC save_structured_address)
  validators/
    addressValidators.js              # confidenceValida, enderecoValidoParaEntrega
  utils/
    addressModel.js                   # modelo canônico único (rua/numero/.../referencia/placeId/provider/confidence)
    addressErrors.js                  # erros granulares (ADR §7): gps_desabilitado/permissao_negada/servico_indisponivel/sem_internet
  hooks/
    useAddress.js, useAddressSearch.js
  components/
    AddressModal/Search/Form/Map/Summary/AddressDetalhesEntrega.jsx  # número/complemento/referência uniformes nas 3 abas

Banco (Postgres/Supabase):
  addresses            (reaproveitada, dormente antes desta referência — agora ativa)
  address_gazetteer     (nova — camada de apoio local, pg_trgm, NUNCA um provedor completo — D-GAZETTEER-BOUNDARY)
  orders.endereco_id    (FK pré-existente, dormente antes desta referência — agora ligada pelo checkout)
  RPCs SECURITY DEFINER: save_structured_address, buscar_gazetteer, create_order (corpo estendido, assinatura intacta)
```

Desvio deliberado do desenho original (§5): a tabela curada de ruas/bairros **não** é um provedor a mais na cadeia declarada em `ORDEM_PADRAO` — é um corretor de 2ª rodada, acionado só quando os 3 providers externos voltam vazios (D-GAZETTEER-ORDER, Onda 4). `DeliveryAreaService` não foi implementada — o encaixe (mesmo padrão `service + RPC + hook` de `deliveryEta.js`) continua reservado, sem código.

### 21.3 Decisões arquiteturais relevantes (consolidado)

| ID | Decisão | Onda |
|---|---|---|
| D-WATERFALL | Cadeia de fallback entre provedores (não "trocar X por Y") — Mapbox → Nominatim → Photon → gazetteer local | 3/4 |
| D-GAZETTEER-ORDER | Corretor local só roda depois que todos os providers externos já voltaram vazios da query original | 4 |
| D-GAZETTEER-BOUNDARY | `address_gazetteer` é permanentemente camada de apoio/fallback — nunca uma base de endereços completa nem substituto dos provedores reais | 4 |
| D-IMMUTABLE-UNACCENT | Wrapper `IMMUTABLE` explícito sobre `unaccent` (a forma de 1 argumento é `STABLE` nesta base — achado por introspecção, não suposição) | 4 |
| D-MAPA-NUMERO-OPCIONAL | Número continua obrigatório em CEP/busca, mas não na aba de Mapa (evita endurecer um caminho que já funciona sem número) | 5 |
| D-NOTFOUND-VS-INDISPONIVEL | Limitação aceita conscientemente: "não encontrado" e "serviço fora do ar" continuam indistinguíveis na busca por texto (ver §21.4) | 5 |
| D-ENDERECO-ID-VIA-PORDER | Vínculo do pedido ao endereço viaja dentro do `p_order` jsonb já existente, não como parâmetro novo — assinatura de `create_order` fica intacta | 6 |
| D-ENDERECO-NUNCA-BLOQUEIA | Falha ao gravar o endereço estruturado nunca impede o pedido de ser criado (mesmo contrato de `addressRepository.salvar` desde a Onda 2) | 2/6 |
| D-ENDERECO-SEM-CACHE-DE-RETRY | Cada tentativa de checkout regrava o endereço estruturado (sem cache entre retries) — evita vincular um endereço editado no meio do caminho | 6 |

### 21.4 Limitações conhecidas (registradas, não escondidas)

- **Integração real com a API do Mapbox continua PENDENTE.** O adapter está implementado e testado com providers falsos (sem rede), mas nunca foi exercitado contra a API real — não existe `VITE_MAPBOX_TOKEN`/conta neste ambiente. Hoje, na prática, a cadeia efetiva é Nominatim → Photon → gazetteer local (Mapbox fica indisponível e é pulado). Quando o token existir, uma bateria pequena de integração é suficiente — nenhuma refatoração é esperada.
- **`endereco_nao_encontrado` e `servico_indisponivel` continuam indistinguíveis** na busca por texto (D-NOTFOUND-VS-INDISPONIVEL) — o waterfall foi desenhado para nunca lançar em falha total. `sem_internet` cobre o caso mais comum via `navigator.onLine`, mas não cobre "todos os 3 provedores estão fora do ar com internet normal".
- **Seed do `address_gazetteer` é mínimo por design** (4 linhas — só o que foi confirmado ao vivo nesta referência). Crescer essa lista é curadoria de conteúdo futura (SQL puro), não um gap de arquitetura.
- **`addressRepository.salvar()` nunca preenche `customer_id`** no endereço gravado — o campo existe desde a Onda 2, mas nenhum fluxo o popula ainda. Vincular ao cliente logado é um enriquecimento natural fora do escopo desta referência.
- **Endereços órfãos são possíveis** (checkout que falha depois do endereço já ter sido gravado, ou o vínculo não ser aplicado por qualquer motivo) — sem rotina de limpeza; tabela pequena, sem custo de escala relevante hoje.
- **Os `alert()` de campo obrigatório** ("Informe o número da residência") não foram convertidos para o padrão de erro granular (§7) — são uma categoria diferente (validação de campo, não falha de busca/geocoding).

### 21.5 Impactos no sistema

- **Checkout:** continua funcionando 100% como antes para quem não usa os campos novos — nenhuma mudança de comportamento visível quando o endereço estruturado não pode ser gravado. Passa a persistir, adicionalmente, um vínculo real (`orders.endereco_id`) para pedidos de entrega.
- **Banco:** duas tabelas antes dormentes (`addresses`, e a FK `orders.endereco_id`) passam a ser ativamente escritas; uma tabela nova e pequena (`address_gazetteer`) entra em produção como camada de apoio, com escrita restrita a `authenticated`.
- **`create_order`:** corpo estendido, assinatura e grants existentes (`anon`/`authenticated`/`service_role`) intocados — zero necessidade de reconceder permissões.
- **Nenhum outro domínio foi tocado** (catálogo, fidelidade, comanda térmica, admin) — escopo respeitado do início ao fim, conforme definido no §"Não-escopo" desta ADR.
- **Uma correção lateral real** foi feita em `lib/supabase.js` (Onda 4) — um bug pré-existente (acesso a `import.meta.env` sem guarda, quebrava fora do Vite) que nunca tinha sido exercitado antes desta referência; corrigido preservando o padrão literal que o Vite substitui no build, zero mudança de comportamento em produção.

### 21.6 Evidências de validação

- **Suíte de domínio:** 30/30 arquivos de teste + `vite build` limpo, mantidos verdes ao longo de todas as 6 ondas.
- **`tests/checkout.golden.mjs`** (o fluxo mais protegido do projeto): todos os snapshots e pins de fonte continuam batendo, incluindo os 4 pins novos da Onda 6.
- **`tests/address.render.mjs`:** 12/12 casos — âncora `GOLDEN_MODAL_SEARCH` (estado idle, byte-a-byte do monólito original de antes desta referência inteira) permanece idêntica, prova mecânica de zero regressão visual no caminho mais usado.
- **`tests/address.guard.mjs`:** 11 invariantes estruturais (isolamento de I/O, fronteira única do domínio, isolamento de cada novo arquivo).
- **`tests/address-geocoding.golden.mjs`:** normalizadores dos 3 providers + orquestração do waterfall + gazetteer, sem rede real.
- **3 scripts reais contra o banco** (todos `BEGIN...ROLLBACK`, nenhuma escrita persiste): `test:address-schema` (Onda 1, 8/8 PASS), `test:address-gazetteer` (Onda 4, 5/5 PASS, incluindo a prova ao vivo de que "Rua Joao Schlay" acha "Rua João Schlei" com 68% de similaridade), `test:address-onda6-orders` (Onda 6, 8/8 PASS, incluindo vínculo real via JOIN e os dois casos de vínculo inválido tratado graciosamente).
- **3 migrations aplicadas e verificadas por introspecção direta** no banco de produção (Onda 1, Onda 4, Onda 6) — todas aditivas, todas com rollback companion testável.

### 21.7 Relação completa dos commits da referência

| Commit | Onda | Descrição |
|---|---|---|
| `866c1a3` | 1 | Schema estruturado de endereço (fundação) |
| `39d5f7c` | 1 | Fecha Onda 1 — migration aplicada, 8/8 testes reais PASS |
| `b2fba85` | 2 | Repository + validator do endereço estruturado |
| `d84e59b` | 3 | Waterfall de geocoding (Mapbox → Nominatim → Photon) |
| `aba7ecc` | 3 | Registra explicitamente status pendente da integração Mapbox |
| `54d399e` | 4 | Busca fuzzy local (`pg_trgm`) sobre tabela curada |
| `d5ca975` | 4 | Registra diretriz de sustentabilidade do gazetteer |
| `8475f15` | 5a | Número/complemento/referência uniformes nas 3 abas |
| `44cdd04` | 5b | Erros granulares (ADR §7) + fecha documentação da Onda 5 |
| `6f56b88` | 6 | Liga `create_order`/checkout ao endereço estruturado |

Todos os 10 commits foram enviados a `origin/main` no dia 2026-07-27 — nenhum trabalho local pendente de push nesta referência.

### 21.8 Status final

**REF-ADDRESS-02 — CONCLUÍDA.** Onda 7 (`DeliveryAreaService`) permanece reservada como desenho futuro, condicionada a nova aprovação explícita do dono.
