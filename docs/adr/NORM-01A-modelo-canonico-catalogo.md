# ADR NORM-01A — Modelo Canônico do Domínio de Catálogo

- **Status:** PROPOSTO (3 decisões abertas aguardando ratificação do dono do produto — ver §7).
- **Base:** auditoria NORM-01 (forense, com evidência de código + introspecção do banco real `hvbcdxsagkjtfjwvnslo`).
- **Escopo:** domínio de catálogo do app `encanto-react` (`src/App.jsx`, `src/utils/format.js`). NÃO cobre o monólito `Encanto/Encanto` (produção separada, fora de escopo).
- **Regra de uso:** este documento é referência **obrigatória** para NORM-02 em diante. Nenhuma decisão de modelagem pode ser tomada durante a implementação — se surgir ambiguidade não coberta aqui, atualiza-se este ADR **antes** de codar.

---

## 1. Princípios canônicos (invariantes inegociáveis)

1. **Banco é a fonte de verdade.** Toda entidade de catálogo (produto, categoria, adicional) tem como fonte canônica uma tabela em `public`. Estruturas em JS (`MOCK_*`) são **fallback de emergência offline**, nunca fonte.
2. **Um único caminho de acesso a dados.** Toda leitura/escrita passa por `DS` (DataService). Proibido `db.from(...)` fora do `DS`. *(Hoje já é verdade — preservar.)*
3. **Uma única engine de preço.** O cálculo de preço unitário, total e franquia grátis tem **um** dono (módulo `utils/pricing.js`, criado no NORM-03). Nenhum componente recalcula preço por conta própria.
4. **Um único resolvedor de adicionais.** A escolha de fonte + filtragem + agrupamento de adicionais tem **um** dono (módulo `utils/addons.js`, NORM-04).
5. **Pedido é imutável e reconciliável.** `order_items.price` é o snapshot do preço no momento da compra. Invariante: `Σ(order_items.price × quantity) == orders.total`. O caminho de escrita é **exclusivamente** a RPC `create_order`.
6. **WhatsApp é notificação, não fonte.** A mensagem é efeito colateral do checkout (enviada mesmo em falha de persistência — resiliência WhatsApp-first deliberada). Nunca derivar estado a partir dela.

---

## 2. Fonte canônica por entidade

| Entidade | Fonte CANÔNICA | Fallback (só offline) | Campo de identidade |
|---|---|---|---|
| Categoria | `public.categories` | `MOCK_CATS` | `id` (text, ex. `c3`) |
| Produto | `public.products` | `MOCK_PRODS` | `id` (uuid) |
| Adicional | `public.adicionais` | `MOCK_ADS` *(até NORM-05)* | `id` (uuid) |
| Preço base | `products.preco` / `products.preco_promo` / `tamanhos[].preco` | — | — |
| Tamanho (Monte/Batidinha) | `products.tamanhos` (jsonb) | mock inline | `tamanhos[].id` |
| Promoção | `products.preco_promo` (não há entidade) | — | — |
| Combo | `products` em `categoria_id='c1'` (não há entidade) | — | — |
| Carrinho | estado `useCart` + `localStorage('encanto_cart')` `{v,ts,items}` (TTL 12h) | — | `_key` |
| Pedido | `public.orders` + `order_items` + `customers` (via RPC `create_order`) | — | `id` (uuid) |

---

## 3. Modelo canônico de cada entidade

### 3.1 Categoria
- Tabela `categories`: `{ id(text), nome, ordem, ativo, icone, cor }`.
- **Ordenação** sempre por `ordem`. **Visibilidade** na loja: `ativo=true` E não estar em `CATEGORIAS_DESCONTINUADAS` (filtro por nome normalizado).
- `MOCK_CATS` deve ser reduzido a um espelho mínimo (ou eliminado) — hoje **diverge** do banco em ícone/cor (ex.: c3 🍇 no banco vs 🍧 no mock). O banco vence sempre.

### 3.2 Produto
- Tabela `products`. Campos canônicos: `id, nome, descricao, preco, preco_promo, categoria_id(FK text), disponivel, destaque, badge, ordem, adicionais_gratis, grupos_ad(text[]), upsell_bebida, tamanhos(jsonb), composicao(text[]), imagem_url`.
- **Imagem:** `imagem_url` é a **única** coluna canônica. `image_url` (coluna legada) é **abolida** — nunca lida nem escrita pelo app; será dropada no NORM-06 após confirmar paridade (hoje: 10 linhas com `image_url`, **0 órfãs**).
- **Multi-categoria:** `categoria_ids` **NÃO é canônico** (não existe coluna; nunca persistido). → **Decisão aberta D1 (§7).**
- Campos `variantes/aviso/obs_campos/subgrupo/subgrupo_label`: hoje só existem no MOCK (sem coluna). → `variantes` é **Decisão aberta D3 (§7)**; os demais são código morto a remover.

### 3.3 Adicional
Modelo canônico da tabela `adicionais`:
- `{ id(uuid), nome, grupo(text), tipo('gratis'|'pago'), preco(numeric), ativo, ordem, aplica_categoria_id(FK text, opcional), descricao }`.
- **`grupo` = chave granular do grupo de adicionais** (ex.: `simples`, `premium`, `frutas_premium`, `chocolates` para a linha açaí; `marmita` para proteínas). *Esta é a modelagem já adotada na categoria viva c3 — adotada como canônica para minimizar churn de dados.*
- **`tipo`** define elegibilidade à franquia grátis: `simples → gratis`; demais → `pago`.
- **`preco`** = preço quando pago. Em linhas `tipo='gratis'`, `preco` representa o **valor do excedente** (quando a cota grátis se esgota) — hoje `2.00`. *(Duplo sentido de `preco` em linha grátis é um cheiro — ver §6 #7; padronizar via constante/`settings`.)*
- **Vínculo produto→adicionais:** `products.grupos_ad` (array de chaves de `grupo`) é **autoritativo**. `CAT_ADDON_GROUP` é **apenas fallback** para produtos sem `grupos_ad` (legado/mock).
- **Rótulos de exibição** (cabeçalhos de seção, ex.: "🍫 Chocolates") vêm de um mapa `GRUPO_LABEL` no frontend — não são dado de domínio.
- **Migração pendente (NORM-05):** o `MOCK_ADS` usa taxonomia grossa `{acai, marmita}` com `subgrupo_label`; deve ser convertido para a taxonomia granular da tabela. → **Decisão aberta D2 (§7).**

### 3.4 Preço (regra única)
- **Preço base do produto** = `tamanhos[escolhido].preco` se o produto tiver `tamanhos`; senão `preco_promo ?? preco`.
- **Promoção ativa** ⇔ `preco_promo != null && preco_promo < preco`.
- **Preço unitário do item** = `base + Σ(adicionais resolvidos.preco)`.
- **Total** = `Σ(unitário × qty)`.
- **Campo `price`** é **abolido** no catálogo. Sobrevive **apenas** em `order_items.price` (snapshot do pedido) — canônico para pedidos. A tolerância `tamanho.price` (em `format.js`) é legado morto, a remover.
- **Constante** `ADICIONAL_SIMPLES_PRECO = 2.00` (hoje hard-coded em 3 lugares) passa a ser única (idealmente em `settings`).
- **Dono:** `utils/pricing.js` (NORM-03). Hoje a regra está espalhada em ~7 locais (ver §6 #1) — todos passam a importar a engine.

### 3.5 Franquia grátis (cota de adicionais simples)
- **Fonte:** `tamanhos[escolhido].adicionais_gratis` se houver tamanho; senão `products.adicionais_gratis`.
- O cálculo "primeiros N grátis, excedente cobra" é da engine (`selComPreco`), derivado do estado atual da seleção.
- `getGratisAcai` (grátis por nome do produto) é **abolido** (código morto).

### 3.6 Promoção
- **Não é entidade.** É o par `preco/preco_promo` + `badge:'promocao'` (cosmético). A categoria descontinuada "Promoção do Dia" (`c2`, inativa) **não** é mecanismo de promoção.

### 3.7 Combo
- **Não é entidade.** Combo = `product` na categoria `c1` (Combos) cujo `grupos_ad` abrange mais de um grupo → o modal renderiza seções de adicionais rotuladas. Configuração é responsabilidade do catálogo (produto), não de código.

### 3.8 Monte seu Copo (c3) e Batidinhas (c9)
- **Não são componentes especiais.** Ambos = produtos com `tamanhos` jsonb `[{id,label,preco,adicionais_gratis?}]` renderizados pela engine genérica de `ProductModalInner`.
- `composicao` (text[]) é opcional e canônico (usado por Batidinhas).
- O `nome.includes('combo'/'destaque')` no render é **puramente cosmético** (estilo de banner). **Proibido** embutir regra de negócio nesse match de string.

### 3.9 Carrinho
- Estado `useCart`, persistido em `localStorage('encanto_cart')` no envelope `{v:1, ts, items}` (TTL 12h, versão, sanitização).
- **Item** = `{...prod, qty, adicionais:[resolvidos], obs, _key}`. Os `adicionais` já carregam o **preço resolvido** no momento do "Adicionar" (grátis→0, excedente→2.00). `_key` = `id + ids-de-adicionais-ordenados + obs`.
- O carrinho é a base do checkout; preços resolvidos no add-time são imutáveis até remoção.

### 3.10 Checkout
- Monta a partir do carrinho no submit: `customer{name,phone}`, `order{total,status,payment_method,address,observacoes}`, `items[{product_id(uuid|null), nome_produto, quantity, price, preco_unitario, adicionais(jsonb), observacoes}]`, `request_id` (idempotência durável em `localStorage('encanto_req_id')`).
- **Caminho de escrita único:** `DS.savePedido → rpc create_order` (transacional, idempotente). `product_id` só vai quando é uuid (mock offline → null).
- Invariante de reconciliação (§1.5) deve sempre fechar.

---

## 4. Matriz de responsabilidade (quem é dono de cada regra)

| Regra de negócio | Dono CANÔNICO (alvo) | Estado hoje |
|---|---|---|
| Cálculo de preço unitário/total | `utils/pricing.js` (NORM-03) | espalhado em ~7 locais |
| Franquia grátis (cota) | `utils/pricing.js` + campos `adicionais_gratis` | 3 fontes + 1 morta |
| Escolha de fonte de adicionais | `utils/addons.js` (NORM-04/05) | `getFonteAdicionais` (hardcode c3) |
| Filtragem/agrupamento de adicionais | `utils/addons.js` | `getAdicionaisProd` + `getAdsByGrupo` (duplicado) |
| Vínculo produto→grupos de adicional | `products.grupos_ad` (+ `CAT_ADDON_GROUP` fallback) | ok, mas taxonomias divergem |
| Visibilidade de categoria | `DS.getCats` + `ativo` + `CATEGORIAS_DESCONTINUADAS` | ok |
| Leitura/escrita de catálogo | `DS` | ok (único) |
| Persistência de pedido | RPC `create_order` | ok (único, endurecido) |
| Notificação WhatsApp | `CheckoutPage` (1 builder) | builder duplicado (msg + resumo) |
| Validação de URL de imagem | helper único `isHttpUrl` | repetido em 4 locais |
| Sanitização de imagem na escrita | `DS._sanitizeImageUrl` | ok |

---

## 5. Severidade — definições

- **CRÍTICA:** pode levar a preço/pedido errado ou perda de dado; ou **bloqueia** um NORM seguinte sem decisão prévia.
- **ALTA:** diverge comportamento entre caminhos (online/offline) ou engana o operador; alto risco de regressão se tocado sem unificar.
- **MÉDIA:** duplicação/regra espalhada que eleva custo de manutenção, mas hoje reconcilia/funciona.
- **BAIXA:** cosmético, dado morto inofensivo, naming.

## 6. Inconsistências classificadas

| # | Inconsistência | Sev. | Resolvida em | Evidência |
|---|---|---|---|---|
| 1 | Preço calculado em ~7 locais (regra espalhada) | **ALTA** | NORM-03 | format.js:9; App.jsx:697,761,623,1073,1147,1185 |
| 2 | Adicionais meio-migrados: Admin edita tabela mas só **c3** lê dela (editar marmita não afeta a loja) | **ALTA** | NORM-05 | App.jsx:245-251,449 |
| 3 | Taxonomia de grupo divergente (DB `simples/premium/...` × MOCK `acai/marmita`); c3 colapsou a família | **ALTA** | NORM-05 (este ADR define o alvo) | adicionais.grupo × CAT_ADDON_GROUP |
| 4 | Catálogo-sombra MOCK diverge do banco (nomes/ícones/sabores) → offline mostra cardápio diferente | **ALTA** | NORM-06 | MOCK_CATS/PRODS × DB |
| 5 | Resolver de adicionais duplicado (`getAdicionaisProd` × `getAdsByGrupo` refiltra) | **MÉDIA** | NORM-04 | App.jsx:254-282 |
| 6 | `categoria_ids` (multi-cat) sem coluna — feature fantasma; "Destaques" subpovoada | **MÉDIA** | NORM-06 (D1) | App.jsx:507; schema products |
| 7 | "Grátis" expresso de 2 formas (`preco:0` × `tipo:'gratis'`+`preco:2.00`); duplo sentido de `preco` | **MÉDIA** | NORM-05 | MOCK_ADS:186 × adicionais c3 |
| 8 | Magic `2.00` em 3 locais | **MÉDIA** | NORM-02 | App.jsx:744,758,937 |
| 9 | `variantes` (escolha de sabor) só no MOCK → inacessível em produção | **MÉDIA** | NORM-06 (D3) | App.jsx:846; schema |
| 10 | Acoplamento de render por nome (`includes 'combo'/'destaque'`) | **MÉDIA** | NORM-06 | App.jsx:3528 |
| 11 | `image_url` coluna legada (morta na leitura/escrita; 0 órfãs) | **BAIXA** | NORM-06 | cols products; upsertProd:431 |
| 12 | `getGratisAcai` código morto | **BAIXA** | NORM-02 | App.jsx:225 |
| 13 | Tolerância `tamanho.price` morta | **BAIXA** | NORM-02 | format.js:8 |
| 14 | Validação URL imagem repetida 4× | **BAIXA** | NORM-02/03 | App.jsx:665,785,1079,416 |
| 15 | Builder WhatsApp/resumo duplicado | **BAIXA** | NORM-03 | App.jsx:1183,1207 |
| 16 | `c2` inativa + 2 produtos órfãos; campos `aviso/obs_campos/subgrupo` mortos | **BAIXA** | NORM-06 | DB; App.jsx:834,953 |

---

## 7. Decisões abertas (exigem ratificação do dono do produto)

> Estas três decisões **não** são técnicas — mudam o modelo canônico. Devem ser fechadas AGORA para não vazar para a implementação.

- **D1 — Multi-categoria (`categoria_ids`).** Manter (criar junction `product_categories` + UI no admin) ou **remover** (1 produto = 1 categoria; "Destaques" passa a ser seção virtual via flag `destaque=true`, que já existe)? **Recomendação: remover.**
- **D2 — Fonte única de adicionais.** Migrar `MOCK_ADS` (marmita/combo/açaí) para a tabela `adicionais` (admin controla tudo) ou manter híbrido (só c3 no banco)? **Recomendação: migrar.**
- **D3 — Variantes (escolha de sabor/suco).** É feature ativa (precisa coluna `variantes` + UI no admin), descontinuada (remover branches do modal) ou manter só como MOCK? **Recomendação: a definir com o produto.**

*(Quando ratificadas, atualizar o Status deste ADR para ACEITO e fixar D1/D2/D3 nas §3.2/§3.3.)*

---

## 8. Vínculo com o roadmap

| NORM | Entrega | Depende deste ADR |
|---|---|---|
| 02 | limpeza segura (morto, magic→const, `isHttpUrl`) | §3.4, §6 #8/#12/#13/#14 |
| 03 | engine de preço/grátis única (`utils/pricing.js`) | §3.4, §3.5, §4 |
| 04 | resolvedor de adicionais único (`utils/addons.js`) | §3.3, §4, §6 #5 |
| 05 | fonte única de adicionais (migrar MOCK→tabela) | **D2**, §3.3, §6 #2/#3/#7 |
| 06 | schema/dado: multi-cat, dropar `image_url`, domar MOCK | **D1/D3**, §3.2, §6 #4/#6/#9/#11/#16 |

## 9. Invariantes de teste (todo NORM deve preservar)

1. `Σ(order_items.price × quantity) == orders.total` (reconciliação).
2. Total de N carrinhos-amostra **idêntico bit-a-bit** antes/depois de qualquer refactor de preço (golden test NORM-03).
3. Saída do resolvedor de adicionais por categoria **idêntica** antes/depois (snapshot NORM-04).
4. Nenhum pedido/cliente real alterado ou removido.
5. Checkout, Monte, Batidinhas, Fidelidade, WhatsApp e engine de preço só mudam o estritamente necessário e com evidência.
