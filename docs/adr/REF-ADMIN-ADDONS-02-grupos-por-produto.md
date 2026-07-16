# REF-ADMIN-ADDONS-02 — Grupos de adicionais por produto (config no Admin)

## 1. Contexto

O sistema já modela adicionais pela relação **Grupo → Adicionais** (`adicionais.grupo`), e a
loja já exibe, para cada produto, apenas os adicionais dos grupos permitidos. Faltava ao lojista
um **controle explícito, por produto, de quais grupos de adicionais aparecem** — hoje isso só
existia implicitamente pelo fallback de categoria.

### Evidência: a infraestrutura já existia (auditoria do banco de produção)

- **Coluna `products.grupos_ad` (`text[]`) já existe e está em uso:**
  - 5 produtos `c3` (Monte seu Copo) = `['chocolates','frutas_premium','premium','simples']`;
  - 4 produtos `c9` (Batidinhas) = `[]` (vazio explícito → **sem** adicionais);
  - 29 produtos = `null` → caem no fallback `CAT_ADDON_GROUP[categoria_id]`.
- **Adicionais (35):** `acai:15` e `marmita:5` com `aplica_categoria_id=null` (valem para todos);
  `simples:6 / premium:4 / frutas_premium:3 / chocolates:2` com `aplica=c3`; `bebida:0`.
- **Leitura já traz o campo:** `DS.getProds/getAllProds` usam `select('*')`.
- **Escrita já persiste o payload:** `DS.upsertProd({...data})` — mesmo padrão do `categoria_ids`
  (`text[]`), que já grava em produção desde REF-ADMIN-CATALOG-01.
- **Domínio já resolve por produto:** `gruposDoProduto(prod) = prod?.grupos_ad ?? CAT_ADDON_GROUP ?? [ACAI]`.
- **Cliente já respeita fim-a-fim:** `StoreApp` → `resolverAdicionais(selecionarFonteAdicionais(prod, ads), prod)`
  → `agruparPorGrupo` → `ProductModal`.
- **Comportamento travado por teste:** `tests/addons.golden.mjs` casos 3 (`null`→fallback), 4
  (`[]`→sem adicionais), 4b (`gruposDoProduto` respeita `[]`), P1 (grupos setados na ordem).

**Causa raiz do gap:** apenas a UI do Admin de produtos (`AdminProducts.jsx`) não tinha campo para
ver/editar `grupos_ad`, e o `save()` (que monta um `data` explícito, sem spread do form) não incluía
o campo. Nenhuma outra camada precisava mudar.

## 2. Decisão

**Reutilizar `products.grupos_ad` e o domínio `addons.js`. Zero migração. Uma única alteração de
produção: `AdminProducts.jsx`.** A tela de produtos ganha um checklist multi-seleção de grupos.

- **Lista de grupos = DINÂMICA (escalável):** grupos distintos entre os adicionais **aplicáveis à
  categoria do produto** (`aplica_categoria_id` nulo ou == categoria) ∪ os já selecionados. Cadastrar
  adicionais em um grupo novo (ex.: `molhos`) faz o grupo aparecer sozinho no checklist — **sem código
  novo**. Grupo desconhecido recebe rótulo derivado da chave (`molhos` → “Molhos”).
- **Pré-marcação ao editar = grupos EFETIVOS de hoje** (`gruposDoProduto(p)`, copiado). O checklist
  reflete exatamente o que o cliente já vê; ao salvar, o efetivo vira explícito → **mesmo comportamento,
  sem regressão** para os 29 produtos com `grupos_ad=null`.
- **Produto novo:** `grupos_ad=[]` (nenhum grupo) → default explícito e previsível (“Mousse: nenhum
  grupo → nenhum adicional”).
- **Rótulo/emoji na UI** (regra institucional: o domínio `addons.js` nunca emite rótulo/emoji).

### O que NÃO mudou (preservação da arquitetura)

- `addons.js` (domínio congelado) — golden garante zero drift;
- `DataService` — já lê (`select('*')`) e grava (`{...data}`);
- `ProductModal` / `StoreApp` — já resolvem por `gruposDoProduto`;
- `AdminAdicionais` — continua só CRUD de adicional + grupo (não vira config por produto);
- `deps.audit` — `AdminProducts` já estava na allowlist de consumidores do domínio;
- banco — nenhuma migração (coluna já existe).

## 3. Semântica de `grupos_ad` (inalterada, agora editável)

| Valor | Efeito no cliente |
|---|---|
| `['marmita','acai']` | só adicionais desses grupos |
| `[]` | **nenhum** adicional |
| `null` (legado, não editado) | fallback `CAT_ADDON_GROUP[categoria_id]` |

Ao salvar um produto no Admin, `null` é convertido para o array efetivo explícito
(comportamento idêntico ao fallback — a conversão é *behavior-preserving*).

## 4. Prova / Testes

- `npm run test:addons` — domínio intacto (o contrato `grupos_ad` já era coberto).
- `npm run test:admin-catalog` — governança de catálogo intacta (categoria_ids/destaque/ordem).
- `npm run test:admin-addons` — **novo** guard estrutural: Admin importa o domínio, deriva a lista
  dinamicamente, escreve `grupos_ad`, pré-marca pelos grupos efetivos; `DataService` persiste;
  contrato do domínio e escopo do `AdminAdicionais` preservados.
- `npm run test:deps` / `test:render` / `npm run build` — verdes.

## 5. Dívidas / notas

- `bebida` só aparece no checklist após existir ao menos 1 adicional nesse grupo (coerente com
  “Grupo → Adicionais”). Fluxo: cadastrar o adicional no grupo primeiro.
- Modelo dual de `c3` (subgrupos `simples/premium/frutas_premium/chocolates`) permanece como dado
  legado; o checklist os exibe fielmente para produtos `c3` e os oculta para categorias onde não se
  aplicam (filtro por `aplica_categoria_id`).
