# ADR REF-DELIVERY-FEE-03 — Modelo de distância viária e política de tarifação

**Status:** SUPERADO — o dono decidiu (fora deste documento) trocar o provedor recomendado aqui
(Mapbox) por **OpenRouteService/HeiGIT**. A análise de opções A/B/C/D abaixo permanece válida como
registro histórico do raciocínio, mas a decisão/implementação real está em
`docs/ref/REF-DELIVERY-FEE-03-progress.md` — consulte esse arquivo para o estado atual da REF.
**Depende de:** REF-DELIVERY-FEE-01 (taxa por distância), REF-DELIVERY-FEE-02 (blindagem da localização
da loja + correção do filtro de plausibilidade do geocoder, `6b7eba7`).
**Não decide:** se/quando implementar. Só compara opções e recomenda uma linha de partida.

## 1. Contexto

A REF-DELIVERY-FEE-02 fechou os dois bugs reais de geocoding (viés de cidade hardcoded, aceitação cega
de feature implausível tipo rio/POI). Com o geocoder comprovadamente correto, o pedido real de teste
(Rua João Schley, 77, Timbó/SC → Rua Itajaí, Rio Morto, Indaial/SC) resultou em:

```
Distância Haversine (linha reta) = 5,861 km
Faixa aplicada                   = 5,1–6,0 km
Taxa cobrada                     = R$ 12,00
Distância viária de referência   ≈ 10–13 km (Google Maps, fornecido pelo dono — não reverificado
                                    de forma independente nesta REF, tratado como referência aproximada)
```

Isso é uma diferença de **~70% a ~120%** entre linha reta e rota real — não é erro de cálculo, é a
natureza geométrica do Haversine: ele mede a corda entre 2 pontos, nunca o caminho que um motoboy
percorre. Timbó e Indaial ficam separadas pelo vale do Rio Itajaí (relevo + travessia de rio força uma
rota indireta) — um caso onde a razão rota/linha-reta ("fator de circuito") é bem mais alta que a média
de uma malha urbana plana.

**Esta REF não resolve isso.** Ela só entrega a análise para decidir COMO resolver — se é que vale a
pena, dado custo/complexidade/escala do negócio hoje (SaaS nascente, 2 tenants: Encanto + Bar da Sogra).

## 2. Caso de referência (usado em toda a análise)

| | Valor |
|---|---|
| Origem | Rua João Schley, 77 — Bairro dos Estados, Timbó/SC (`company_info.lojaLat/lojaLng`, pino manual) |
| Destino | Rua Itajaí — Rio Morto, Indaial/SC (geocoding confirmado correto, REF-DELIVERY-FEE-02) |
| Haversine hoje | **5,861 km** |
| Rota viária (referência aproximada, não verificada de forma independente) | **≈ 10–13 km** |
| Fator de circuito implícito | **≈ 1,7× a ≈ 2,2×** |
| Taxa hoje (Haversine) | R$ 12,00 (faixa 5,1–6,0 km) |
| Taxa se a faixa fosse por rota real (≈11 km) | R$ 22,00 (faixa 10,1–11,0 km) — **quase o dobro** |

## 3. As 4 opções

### A) Manter Haversine (linha reta) — status quo

**Como funciona:** já implementado (`address/utils/coordinates.js:distanciaKm`) — fórmula geodésica
pura, sem chamada externa.

- **Precisão:** baixa em terrenos com obstáculo geográfico (rio, morro, rodovia sem travessia direta);
  razoável em malha urbana plana e densa. Estruturalmente **sempre subestima** (nunca superestima) —
  linha reta é o limite inferior matemático de qualquer distância real.
- **Custo:** R$ 0. Sem limite, sem conta, sem chave.
- **Latência:** ~0ms (cálculo local, síncrono).
- **Limites/quotas:** nenhum.
- **Escalabilidade SaaS:** perfeita — funciona igual para qualquer tenant, qualquer cidade, sem
  configuração adicional por loja.
- **Cache:** não se aplica (mais barato que cachear).
- **Dependência externa:** nenhuma (zero ponto de falha externo).
- **Disponibilidade:** 100% (não pode cair).
- **Privacidade:** máxima — coordenadas do cliente nunca saem do navegador/Supabase.
- **Impacto no checkout:** nenhum (já é o comportamento atual, tempo real, sem loading extra).
- **Risco de negócio:** subcobra sistematicamente entregas em corredores como Timbó↔Indaial — o motoboy
  roda ~11 km, a loja recebe pelo preço de ~5,9 km. Quanto mais a loja atender bairros/cidades além do
  raio imediato, maior o prejuízo acumulado por pedido.

### B) Haversine + fator de correção

**Como funcionaria:** multiplicar a distância Haversine por uma constante (`distanciaViaria ≈
distanciaHaversine × fatorCircuito`) antes de localizar a faixa. Fator tipicamente citado na literatura
de logística urbana: **1,2–1,4×** para malha urbana densa; regiões com barreira geográfica (rio, serra,
poucas pontes) frequentemente passam de **1,6–2,0×** — exatamente a faixa que este caso real mediu
(1,7–2,2×).

- **Precisão:** melhor que A na média, mas **um único fator não generaliza** — o fator correto para
  "dentro da mesma rua/bairro" (~1,1×) é muito diferente do fator para "atravessar o rio até a cidade
  vizinha" (~2×). Um fator único subcorrige entregas longas/com obstáculo e sobrecorrige entregas curtas
  diretas.
- **Custo:** R$ 0.
- **Latência:** ~0ms (mesma natureza de A, só um multiplicador).
- **Limites/quotas:** nenhum.
- **Escalabilidade SaaS:** **problema real aqui.** O fator ideal depende da geografia local de cada loja
  (uma loja em terreno plano precisa de um fator bem menor que uma loja cortada por rio/serra). Ou o
  sistema usa um fator genérico (impreciso para muitos tenants) ou exige calibração manual por loja
  (mais um campo de configuração, mais um jeito de errar, sem fonte de verdade objetiva para calibrar —
  só medindo rotas reais, o que devolve o problema para a opção C).
- **Cache:** não se aplica.
- **Dependência externa:** nenhuma.
- **Disponibilidade:** 100%.
- **Privacidade:** máxima (idêntica a A).
- **Impacto no checkout:** nenhum, tempo real.
- **Risco de negócio:** reduz o erro médio mas não o elimina, e cria uma ilusão de precisão ("o sistema
  agora calcula rota") que não é real — pode gerar reclamação inversa (cliente perto em linha reta mas
  com fator alto pagando caro por um trajeto que na prática é curto).

### C) Routing engine / API de rota real

**Como funcionaria:** substituir (ou complementar) o Haversine por uma chamada a um serviço que calcula
distância de rota real (grafo viário do OpenStreetMap ou equivalente), na mesma janela de tempo real do
checkout hoje.

Duas famílias de implementação, com trade-offs bem diferentes:

**C1 — API paga gerenciada (Mapbox Directions/Matrix, Google Routes)**

| | Mapbox Directions/Matrix | Google Routes (Compute Routes) |
|---|---|---|
| Free tier | 100.000 requisições/mês grátis (Directions) [[Mapbox pricing]](https://docs.mapbox.com/accounts/guides/pricing/) | Crédito inicial (US$200), sem tier grátis permanente |
| Custo após free tier | US$2,00/1k (100k–500k), depois US$1,60/1k [[Mapbox pricing]](https://docs.mapbox.com/accounts/guides/pricing/) | US$5,00/1k (Basic) a US$10,00/1k (Advanced) [[Google Routes billing]](https://developers.google.com/maps/documentation/route-optimization/usage-and-billing) |
| Matrix API | Cobrada por **elemento** (par origem×destino), não por request; limite de 25 coordenadas/chamada [[Mapbox Matrix docs]](https://docs.mapbox.com/api/navigation/matrix/) | Compute Route Matrix, cobrado por elemento |
| Rate limit | 60 req/min (Directions) / 30 req/min (Matrix) por padrão | Cota configurável, billing pay-as-you-go |
| Token client-side | **Sim** — token público restrito por domínio, igual ao já usado (pendente) para Geocoding | Não recomendado (chave exposta cobra do dono se vazar) — exige proxy server-side |
| Aproveitamento do que já existe | **Alto** — Mapbox já é o provedor "principal" desenhado na REF-ADDRESS-02 (`mapboxProvider.js` já implementado, só falta `VITE_MAPBOX_TOKEN`); mesma conta/token cobriria geocoding **e** rota | Nenhum — stack novo, conta nova, proxy novo |

**C2 — Self-host (OSRM, sem custo por requisição)**

OSRM (Open Source Routing Machine) — engine em C++ especializado em rota, roda sobre extrato do
OpenStreetMap, HTTP API própria, sub-milissegundo por cálculo depois de pré-processado
[[OSRM project]](https://project-osrm.org/) [[OSRM backend]](https://github.com/Project-OSRM/osrm-backend).

- **Precisão:** alta — grafo viário real, a mesma classe de motor que a Mapbox/Google usam por baixo
  (Mapbox inclusive é fork/consumidor do ecossistema OSRM-like).
- **Custo:** sem custo por requisição — mas exige **infraestrutura própria** (VPS/container rodando
  24/7), que este projeto hoje não tem (é Vercel serverless + Supabase gerenciado, zero servidor
  próprio). Custo estimado de um VPS pequeno o bastante para uma região SC (extrato regional, não
  o Brasil inteiro): baixo (na faixa de dezenas de R$/mês), mas é a **primeira peça de infraestrutura
  own-managed** do projeto — muda o perfil operacional (patch, uptime, backup do extrato OSM).
- **Latência:** muito baixa (rede interna, se hospedado perto do Supabase) a moderada (se longe).
- **Limites/quotas:** nenhum imposto por terceiro — só a capacidade do próprio servidor.
- **Escalabilidade SaaS:** boa — um único OSRM cobre qualquer loja dentro da região do extrato OSM
  carregado; adicionar tenant em outro estado/país exige avaliar se o extrato cobre a área (ou carregar
  mais de um extrato).
- **Cache:** natural de acrescentar (mesma camada HTTP).
- **Dependência externa:** o **dado** (OpenStreetMap) é externo, mas a **disponibilidade** do serviço
  passa a ser responsabilidade própria — troca "depender de terceiro" por "manter um servidor".
- **Disponibilidade:** depende inteiramente de como for operado (sem SLA de terceiro, sem fallback
  automático se não for desenhado).
- **Privacidade:** alta — nenhuma coordenada de cliente sai para fora da própria infraestrutura.
- **Impacto no checkout:** chamada de rede adicional (latência real, não instantânea como hoje).

### D) Modelo híbrido

Duas variantes que combinam A/B/C, reduzindo o custo/latência da opção C sem abrir mão da precisão onde
ela importa:

**D1 — Haversine primeiro, rota real só perto da fronteira de faixa.** Como as faixas têm largura de
~1 km, um erro de Haversine só muda o valor cobrado quando o resultado cai perto de um limite de faixa.
Calcula Haversine sempre (grátis, instantâneo); só chama a API de rota quando a distância Haversine está
a poucos km de um limite (ou sempre acima de um piso, ex. >3 km, onde o fator de circuito começa a
importar de verdade). Reduz drasticamente o volume de chamadas pagas/latência, sem perder precisão nos
casos que realmente mudam o preço.

**D2 — Cache por corredor.** A grande maioria das entregas de uma loja se repete nos mesmos
bairros/rotas. Cachear a distância de rota real por par (origem da loja, destino arredondado a uma
grade de ~200-500m, ex. geohash) faz a primeira entrega de um corredor pagar o custo da API; todas as
seguintes reaproveitam o valor já medido. Reduz custo recorrente a quase zero depois do "aquecimento" do
cache, mantendo precisão de rota real.

D1+D2 combinados é o desenho mais eficiente das 4 opções em custo/latência agregados, ao preço de mais
uma peça de estado (cache) para manter.

- **Escalabilidade SaaS:** boa — cache e piso de ativação são por-tenant automaticamente (cada loja
  cacheia seus próprios corredores).
- **Impacto no checkout:** próximo de A/B na maioria dos pedidos (cache/Haversine resolve sem rede);
  só os primeiros pedidos de um corredor novo pagam a latência de C.

## 4. Tabela comparativa consolidada

| Critério | A) Haversine | B) Haversine+fator | C) Routing API/engine | D) Híbrido |
|---|---|---|---|---|
| Precisão | Baixa (sempre subestima) | Média (fator único não generaliza) | Alta | Alta (onde importa) |
| Custo/mês (escala atual, 2 tenants, dezenas de pedidos) | R$0 | R$0 | R$0 (dentro do free tier Mapbox) | R$0 |
| Custo/mês (escala futura, milhares de pedidos) | R$0 | R$0 | Baixo a moderado (tiered, ver §3) | Baixo (cache reduz volume) |
| Latência no checkout | ~0ms | ~0ms | +rede (dezenas a centenas de ms) | ~0ms na maioria, +rede só 1ª vez/corredor |
| Limite/quota externo | — | — | Sim (rate limit + billing) | Sim, mas raramente atingido |
| Escala multi-tenant | Perfeita | Ruim (calibração por loja) | Boa | Boa |
| Dependência externa nova | Nenhuma | Nenhuma | Sim (API) ou infra própria (OSRM) | Sim, mas amortizada |
| Disponibilidade | 100% | 100% | Depende do provedor/SLA | Degrada bem (cai pra Haversine se a API falhar) |
| Privacidade | Máxima | Máxima | Coordenada do cliente trafega pro provedor (Mapbox/Google) | Igual a C, só nos casos que chamam a API |
| Reaproveita infra já planejada | — | — | **Sim, se Mapbox** (token já desenhado na REF-ADDRESS-02) | Sim (mesma base de C) |
| Complexidade de implementação | Nenhuma (já existe) | Baixa | Média (client-side se Mapbox; proxy se Google) | Média-alta (cache novo) |

## 5. Recomendação (para decisão do dono — nada disto foi implementado)

**Curto prazo, se o objetivo é parar de subcobrar sem aumentar complexidade agora:** opção **B com fator
conservador** (ex. 1,4×) é a mudança mais barata e rápida, mas o próprio caso de referência prova seu
limite — 1,4× de 5,861 km = 8,2 km (faixa 8,1–9,0 km, R$18) ainda fica longe dos ~11 km reais (faixa
10,1–11,0, R$22). B reduz o erro, não o resolve, e não tem como resolver de forma genérica sem virar C.

**Recomendação técnica para quando o negócio justificar o investimento:** **C1 com Mapbox
Directions/Matrix**, dentro do desenho **D1** (só chama a API perto de fronteira de faixa ou acima de um
piso de km). Motivos:
1. **Zero stack novo** — o Mapbox já é o provedor "principal" desenhado (não implementado) desde a
   REF-ADDRESS-02; o mesmo `VITE_MAPBOX_TOKEN` (ainda pendente, decisão do dono, fora desta REF) cobriria
   geocoding e rota com uma conta só.
2. **Token client-side é seguro** (restrito por domínio), preserva a arquitetura atual (cálculo em tempo
   real no navegador, sem precisar inventar um backend novo).
3. **Free tier (100k/mês) cobre a escala atual e a projetada no curto/médio prazo** com folga — 2
   tenants, pedidos na casa de dezenas/dia, não chegam perto do limite.
4. **D1 reduz ainda mais o consumo** — a maioria dos pedidos (bem dentro de uma faixa, longe de
   fronteira) nem precisa da chamada.

**OSRM self-host (C2)** só se justifica se o volume crescer a ponto de estourar os tiers pagos do Mapbox
de forma consistente, ou se a política de privacidade da VALION exigir que coordenada de cliente nunca
trafegue para um provedor terceiro — nenhum dos dois é o caso hoje.

## 6. O que NÃO foi feito nesta REF

- Nenhuma linha de código alterada.
- Nenhuma tabela de preço alterada.
- Nenhuma migration.
- Nenhuma API key criada/configurada.
- Nenhum commit, push ou deploy.
- Nenhuma decisão tomada — a §5 é recomendação, não execução.

## 7. Próximos passos (só se/quando aprovado — fora do escopo desta REF)

1. Decisão do dono: manter A, adotar B como paliativo, ou seguir para C/D.
2. Se C/D: decisão sobre `VITE_MAPBOX_TOKEN` (criar conta Mapbox — passo que já estava pendente desde a
   REF-ADDRESS-02, independente desta REF).
3. Plano de implementação dedicado (fora desta REF): pontos de integração (`CheckoutPage.jsx`,
   `deliveryFeeRules.js`), fallback obrigatório para Haversine se a API falhar/timeout (nunca bloquear o
   checkout — mesmo princípio já usado em `sem_coordenadas`), testes de regressão, custo real medido
   antes do cutover de produção.

## Fontes consultadas (pricing/limites, verificado nesta REF)

- [Mapbox — Pricing by products](https://docs.mapbox.com/accounts/guides/pricing/)
- [Mapbox — Matrix API docs](https://docs.mapbox.com/api/navigation/matrix/)
- [Google — Route Optimization API usage and billing](https://developers.google.com/maps/documentation/route-optimization/usage-and-billing)
- [Project OSRM](https://project-osrm.org/) · [OSRM backend (GitHub)](https://github.com/Project-OSRM/osrm-backend)
