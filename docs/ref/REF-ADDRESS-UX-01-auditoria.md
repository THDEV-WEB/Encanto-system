# REF-ADDRESS-UX-01 — Refinamento da experiência de endereços

Auditoria read-only, 17 ago 2026. Zero alteração de banco/código/deploy nesta fase. Espelho do
artifact publicado na sessão (design completo, com evidências formatadas).

**Objetivo da REF**: evoluir "digitar → sugestões" para "digitar → selecionar → confirmar número →
salvar → reutilizar em Endereços Recentes". Exclusivamente UX/persistência — não toca
REF-DELIVERY-FEE-03, REF-ADDRESS-AUTOCOMPLETE-01, routing/HeiGIT, `deliveryFeeRules.js`, waterfall
Photon→Nominatim, nem a migration de confidence já aplicada.

## Achado crítico (Fase 6) — RLS de `addresses` aberta em produção

A única policy em `public.addresses` é `"Auth all addresses" FOR ALL TO authenticated USING (true)
WITH CHECK (true)`, e o papel `authenticated` tem grants diretos de SELECT/INSERT/UPDATE/DELETE/
TRUNCATE na tabela (confirmado via `pg_policies` + `information_schema.role_table_grants`, produção,
17 ago 2026). Efeito: **qualquer cliente autenticado de qualquer loja pode ler/alterar/apagar o
endereço de qualquer outro cliente de qualquer loja**, hoje, via PostgREST direto — independente do
que o frontend pergunte. Anterior a esta REF, mas passa a importar mais aqui porque o objetivo
(histórico reutilizável) faria a tabela passar a ter dado real e valioso de clientes recorrentes.

Precedente já resolvido no projeto para o mesmo tipo de bug: REF-CLIENTE-02 corrigiu exatamente essa
classe de policy (`USING(true)`) em `order_events`. Proposta de correção (SQL exato, NÃO aplicado) no
artifact — espelha o padrão já em produção em `orders` (`customer_id IN (SELECT c.id FROM customers
WHERE auth_user_id = auth.uid())`).

**NÃO corrigido — só reportado**, por instrução explícita ("PARAR e reportar, não corrigir
silenciosamente"). Aguardando decisão.

## Achados principais (Fase 1, 17 perguntas)

- Arquitetura do autocomplete inalterada desde o fechamento da REF-ADDRESS-AUTOCOMPLETE-01.
- Número da residência: campo separado (`cepNumero`), só pedido após selecionar a rua, **nunca**
  reenviado ao geocoder, **nunca** eleva `confidence` — já é o comportamento correto pedido nas
  Fases 2/3.
- `addresses` tem 18 colunas, já inclui `customer_id` (FK → `customers`) e `store_id` (FK → `stores`),
  sem `updated_at` nem coluna de favorito/padrão.
- `customer_id` existe no schema mas **nunca é populado**: 0 de 22 linhas reais preenchidas — o único
  call-site (`CheckoutPage.jsx` → `addressRepository.salvar(endereco)`) nunca passa `customerId`
  (`addressModel.js` nem tem esse campo no objeto canônico).
- Não existe histórico nem endereço padrão hoje — nem UI, nem query, nem RPC de leitura
  (`addressRepository` só tem `.salvar()`).
- Persistência local: uma única chave `encanto_delivery` no `localStorage`, um endereço por vez — não
  é histórico, reforça que o histórico real precisa vir do banco.

## Evidência ao vivo — número da residência (Fase 2/3/10)

Testado contra Photon e Nominatim reais com a própria rua de exemplo do dono (Rua Itajaí, Indaial/SC):
nenhum dos dois provedores retorna `housenumber`/`house_number` para essa rua; Photon inclusive
**ignora completamente** o número quando embutido no texto ("Rua Itajaí, 100" e "Rua Itajaí, 200"
devolvem resultado idêntico). Confirma tecnicamente a preferência já expressa pelo dono: Opção B
(usuário sempre confirma o número) é o comportamento garantido; Opção A (provedor sugere) é bônus
condicional, raro na prática (achado já visto em ruas de Blumenau/Jaraguá em teste anterior).

## Proposta (Fase 5/7/15) — aguardando decisão, nada implementado

- **Modelo de dados**: reaproveitar `addresses` integralmente, zero coluna nova no escopo mínimo
  (recentes). Favorito/padrão fica para depois (1 coluna booleana, se decidido).
- **Migrations propostas** (SQL exato no artifact, não aplicado): (1) corrigir RLS de `addresses`;
  (2) índice em `customer_id`; (3) `save_structured_address` passa a derivar `customer_id` via
  `auth.uid()` em vez de confiar no valor enviado pelo client (hardening complementar à RLS).
- **Código**: `CheckoutPage.jsx` passa a incluir `customerId: customer?.id` ao salvar; novo
  `.listar()` em `addressRepository`; novo `AddressClienteService`/`useEnderecosRecentes` espelhando
  o padrão já existente de `PedidosClienteService`/`useMeusPedidos`; componente de UI "Endereços
  recentes".
- **Multi-tenant**: `customer_id` já é 1:1 por (pessoa, loja) via a resolução atual de `customer` —
  filtrar por ele basta, desde que a RLS seja corrigida primeiro.
- **Performance**: debounce/searchGuard/limite de sugestões preservados integralmente; recentes é 1
  consulta ao banco ao abrir o modal, sem nenhuma chamada a provider externo.
- **Testes**: 19 cenários com mocks determinísticos, mesmo padrão `*.golden.mjs` já usado.

Artifact completo (design, tabelas, SQL formatado): link publicado na sessão.
