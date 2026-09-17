# REF-PROMO-01 — Vitrine de Promoções e Preço Promocional

**Status: CONCLUÍDA — 5 commits ao vivo em produção (2026-09-17).**

## Achado inicial (auditoria)

`preco_promo` (produto SEM `tamanhos`) já estava 100% funcional ponta-a-ponta desde
[REF-PRICE-SOURCE-01](REF-PRICE-SOURCE-01-onda1-preco-autoritativo.md): Admin
(`AdminProducts.jsx`) escreve, `ProductCard`/`ProductModalInner` exibem (riscado +
preço promo, selo "PROMO"), `_resolve_item_pricing()` recalcula no servidor. Não
faltava reimplementar nada disso — faltava (1) preço promocional **por tamanho**
(caso real "Encanto Casadinho": 1 copo vs. 2 copos, cada opção com seu próprio
desconto) e (2) uma vitrine dedicada no catálogo do cliente.

A antiga categoria "Promoção do Dia" (`c2`) existe em produção mas está **inativa e
órfã** (`ativo=false`, zero produtos referenciando-a) desde antes desta REF — não era
mecanismo de promoção nenhum, só uma categoria comum descontinuada (confirmado em
`src/utils/catalog.js:CATEGORIAS_DESCONTINUADAS` e nos ADRs `NORM-06`/`NORM-01A`).

## Decisão arquitetural: NÃO usar o Collection Engine (NORM-06/NORM-10)

O schema `categories.tipo/estrategia/definicao/starts_at/ends_at` +
`product_collections` existe em produção (criado pelo NORM-06 F1A/F1B, 2026-06-28/30)
e foi desenhado, entre outras coisas, para uma futura coleção `rule` de "promoções
reais" (marco reservado **NORM-10**). Mas o F2 (backfill) do próprio NORM-06 está
**travado desde 2026-06-27** por uma colisão de dados nunca resolvida — `product_
collections` tem zero linhas, `categories.tipo` é `'business'` em 100% das linhas, e
nenhum código do frontend consome `resolve_collection`/`product_collections`. NORM-10
(o ramo `rule` que faria a resolução dinâmica) nunca foi sequer criado.

Implementar a vitrine sobre essa base exigiria: (a) resolver uma colisão de dados de
outra frente, parada há quase 3 meses; (b) construir do zero o ramo `rule` reservado
para NORM-10. Isso contraria diretamente o escopo desta REF ("não criar uma engine de
promoções complexa", "menor solução estrutural"). A vitrine "Promoções" foi
implementada com o **mesmo mecanismo que já está ao vivo em produção para
"Destaques"**: categoria real + `categoria_ids` (multi-categoria), toggle dedicado no
Admin — nenhuma linha de produto duplicada, nenhuma tabela nova.

## Modelo de dados

- `products.preco_promo` (já existia) — preço promocional de produto **simples**.
  Ganhou uma constraint nova: `CHECK (preco_promo IS NULL OR (preco_promo > 0 AND
  preco_promo < preco))` (nunca tinha validação de banco).
- `products.tamanhos[]` (jsonb, já existia) — cada elemento ganhou uma chave
  **opcional** `preco_promo` (aditiva; tamanho sem a chave nunca muda de
  comportamento). Ex.: `{"label":"1 copo (500 ml)","preco":32.99,"preco_promo":27.99}`.
- `categories` — 1 linha nova: `id='promocoes'`, `nome='Promoções'`, `ativo=true`,
  `tipo='business'`, `icone='🔥'`, `cor='#EA580C'` (mesmo par visual da antiga
  "Promoção do Dia"), `ordem=0` (vitrine aparece primeiro).
- Nenhuma coluna nova em `products`, nenhuma tabela nova.

## Regra de preço (servidor = autoridade final)

`_resolve_item_pricing()` (chamada de dentro de `create_order()`, nunca exposta
diretamente a `anon`/`authenticated`) ganhou um segundo nível de resolução de promoção,
dentro do ramo "produto com tamanhos": depois de resolver o preço do tamanho
selecionado, verifica se esse MESMO elemento tem `preco_promo` válido (`> 0` E `<`
preço cheio DESSE tamanho) e, se tiver, usa-o. Regra mais estrita que o `<> 0` legado
do produto simples (que replica o `||` frouxo do JS, congelado por golden test) —
código novo, sem contrato prévio, protegido desde o primeiro dia contra promo
corrompida/maior-que-o-preço. O mesmo espelho existe no cliente
(`format.js:precoTamanhoEfetivo`), então preço exibido = preço cobrado sempre, mesmo em
cenário adversarial.

Fluxo completo: `products.tamanhos[].preco_promo` → `_resolve_item_pricing()` (servidor,
autoritativo) → `ProductCard`/`ProductModalInner` (exibição) → `useCart`/`pricing.js`
(carrinho, via `preco`/`preco_promo` do item) → `orderPayload.js` (payload do pedido,
`tamanho_label` identifica a escolha, nunca o preço) → `order_items.price/preco_
unitario` (persistido pelo servidor).

## Admin

`AdminProducts.jsx`: campo "Preço promo" por linha de tamanho (validado: `>0` e
`<` preço cheio desse tamanho); toggle "🔥 Promoções (vitrine)" ao lado do já existente
"⭐ Destaque (vitrine)", mesmo mecanismo (categoria resolvida por nome, entra/sai de
`categoria_ids`, nunca vira categoria principal) — duplicado deliberadamente (não
generalizado numa lista de "vitrines") para não introduzir abstração nova.

## Vitrine

Seção "🔥 Promoções" no catálogo do cliente — é só mais uma categoria real (mesma fonte
que todas as outras, `cats` ordenado por `ordem`), sem nenhuma lógica de fetch/filtro
nova. Card mostra preço riscado + promocional quando o tamanho mais barato está em
promoção (mesmo padrão já usado pra produto simples, agora também no ramo "A partir
de"). Produto continua aparecendo normalmente na(s) categoria(s) de origem — confirmado
visualmente que "Encanto Casadinho" aparece 2×: em "Promoções" e em "Copos Prontos",
mesma linha de banco, sem duplicação.

## Caso real: Encanto Casadinho

Produto `d2d5f43e-df11-4ac4-999b-0c8da7401c67` reconfigurado (sem duplicar, sem sair da
categoria "Copos Prontos"):

```json
"tamanhos": [
  {"label":"1 copo (500 ml)",        "preco":32.99, "preco_promo":27.99, "adicionais_gratis":0},
  {"label":"2 copos (500 ml cada)",  "preco":65.98, "preco_promo":49.99, "adicionais_gratis":0}
]
```
`categoria_ids: ['c4','promocoes']` (mantém `c4`=Copos Prontos como categoria
principal). Validado ao vivo: vitrine, card, modal (ambos tamanhos), carrinho e
checkout mostram consistentemente R$ 27,99 / R$ 49,99.

## Multi-tenant

A categoria `promocoes` pertence exclusivamente ao `store_id` da Encanto — confirmado
por consulta direta que nenhuma outra loja (`Aquarios Bar`) tem qualquer linha
referenciando-a. Nenhuma RLS nova foi necessária: reaproveita as mesmas policies já
existentes de `categories`/`products` (`store_ativo(store_id) OR is_admin_of(store_id)`).

## Testes

- `npm run test:domain` (41 suítes, node puro): verde.
- `npm run build` / `npm run lint`: limpos (1 erro pré-existente e não relacionado em
  `scripts/pagamento-01-onda7-csp-brick-test.mjs`, fora do escopo).
- `scripts/promo-01-test.mjs` (novo, contra o projeto Supabase E2E dedicado,
  `BEGIN...ROLLBACK`): 6/6 — tamanho com promo válida, regressão de tamanho sem promo,
  promo corrompida ignorada com segurança, regressão de produto simples, constraint
  rejeitando negativo/zero/maior-que-preço.
- `scripts/price-source-01-onda1/onda2-test.mjs` e `price-hardening-01-test.mjs`
  (pré-existentes, contra E2E): todas as asserções de **preço de item** continuam
  verdes (inclusive o cenário de promoção clássica). A única divergência encontrada é
  pré-existente e não relacionada — asserções de `order.total` desatualizadas desde
  REF-DELIVERY-FEE-05 (taxa de R$2 para pagamento em dinheiro, que não existia quando
  aqueles scripts foram escritos); confirmado com uma consulta manual que `order_items.
  price` bate exatamente, só `orders.total` diverge pela taxa adicional legítima.
- `e2e/tests/admin/admin-produtos-tamanhos.spec.js` +
  `admin-produtos-categorias-destaque.spec.js` (Playwright, contra E2E): 4/4 verde.
- Verificação visual (dev server + Playwright ad-hoc, produto real em produção):
  mobile/tablet/desktop — vitrine, card, modal com ambos os tamanhos, carrinho,
  checkout.

## Migrations

- `REF-PROMO-01-onda1-promo-tamanho-e-constraint.sql` (+ rollback) — `_resolve_item_
  pricing()` com promo por tamanho + `products_preco_promo_check`. Aplicada em
  produção E no projeto E2E (paridade de schema).
- `REF-PROMO-01-onda2-categoria-promocoes-seed.sql` (+ rollback) — categoria
  "Promoções". Aplicada só em produção (dado específico do tenant Encanto).

## Validação pós-deploy

`git push origin main` (commit `a6d7244`) → confirmado via GitHub Deployments API como
`Production` bem-sucedido para os 2 projetos Vercel (`encanto-system` e `encanto-
admin`). A verificação visual em `https://encanto.valionsistemas.com.br/encanto/` (a
URL real de produção, mesma usada por clientes) demorou mais que o esperado: checagens
repetidas via `curl` (poll a cada 10s por vários minutos, tentando confirmar a troca do
hash do bundle JS) acionaram o **Attack Challenge Mode** de segurança da própria
Vercel, que passou a servir uma página de verificação de navegador para as requisições
seguintes — nada a ver com o deploy em si (lição registrada: preferir **1 checagem via
navegador real**, não polling agressivo via `curl`, para confirmar deploy). Após uma
pausa sem requisições, uma única checagem com navegador real confirmou: seção "🔥
Promoções" presente, "Encanto Casadinho" aparecendo 2× (Promoções + Copos Prontos) com
preço riscado + promocional corretos, screenshot full-page da home batendo com o
esperado.

## Pendências

- Nenhuma pendência dentro do escopo desta REF.
- Achado incidental (fora de escopo, registrado para memória futura): os scripts de
  regressão `price-source-01-onda1/onda2-test.mjs` e `price-hardening-01-test.mjs`
  têm asserções de `order.total` desatualizadas desde REF-DELIVERY-FEE-05 (não
  corrigido aqui — fora do escopo de preço promocional).
