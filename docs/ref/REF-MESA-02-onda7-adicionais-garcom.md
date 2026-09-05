# REF-MESA-02 — Onda 7: Adicionais Pagos no Formulário do Garçom

**Status: CONCLUÍDA.** Fecha o gap registrado desde a REF-MESA-01 Onda 4:
`NovoPedidoMesaModal.jsx` suportava tamanho mas nunca adicionais pagos (sempre enviava `adicionais:[]`).

## O que mudou
- `NovoPedidoMesaModal.jsx` ganhou um passo intermediário (mesmo padrão do checkout do cliente):
  escolher produto/tamanho abre um editor de adicionais antes de confirmar o item no resumo.
- Reaproveita as MESMAS funções puras de domínio do checkout do cliente
  (`utils/addons.js::resolverAdicionais/ehAdicionalGratis/cotaGratis/resolverPrecoAdicionais`) —
  nenhum cálculo de preço novo/paralelo, inclusive a franquia de adicionais grátis.
- Adicionais vêm de `DS.getAllAds()` — **já existente** desde a REF-SAAS-01 Onda 5 (usada por
  `AdminAdicionais.jsx`), não uma função nova (encontrei e removi uma duplicata que eu mesmo tinha
  criado por engano antes de notar que já existia).
- Preço/total continuam só estimativa — `create_order()`/`_resolve_item_pricing` seguem intocados,
  é a mesma autoridade de sempre.

## Achados corrigidos antes do commit
1. **Duplicata de método**: criei `DS.getAllAds()` sem checar antes que já existia (mesmo nome,
   comportamento ligeiramente diferente — o existente não filtra `ativo`, então adicionei o filtro
   no componente). Lint (`no-dupe-keys`) pegou isso imediatamente.
2. **Guard arquitetural `test:deps` (D1 — allowlist de consumidores de domínio)**: `utils/addons.js`
   tem uma lista explícita de quem pode importá-lo ("sem consumidor-surpresa"). Registrei
   `NovoPedidoMesaModal.jsx` na allowlist no mesmo commit, em vez de contornar o guard.
3. **Regressão E2E real**: `admin-pedidos-novo-mesa.spec.js` esperava que clicar "+ Adicionar"
   já deixasse o item pronto no resumo — agora existe um passo de confirmação intermediário.
   Corrigido o spec para clicar "Adicionar ao pedido" antes de checar o resumo (2/2 voltou a passar).

## Testes
- `scripts/mesa-02-onda7-adicionais-garcom-test.mjs` (novo, 3/3): `create_order()` via `admin_garcom`
  com um adicional real (não string inventada — `_resolve_item_pricing` exige UUID de uma linha
  real) persiste `order_items.adicionais` e calcula `preco_unitario` corretamente (produto R$20 +
  adicional R$5 = R$25, sempre server-side).
- `e2e/tests/admin/admin-pedidos-novo-mesa.spec.js`: 2/2 (atualizado).
- `tests/deps.audit.mjs`: verde (allowlist atualizada).

## Regressão completa
lint (0 erros, 60 warnings pré-existentes), typecheck limpo, `build:admin` ok. Backend: MESA-01
60/60 + interseção 10/10 + MESA-02 onda2-6 70/70 + onda7 3/3 + DELIVERY-FEE-05 29/29 +
`test:domain` verde (inclui `deps.audit.mjs` corrigido) = **172/172** + E2E do modal 2/2.

## Produção
Não tocada — nenhuma migration nesta onda (mudança 100% frontend + 1 método de serviço reaproveitado).
