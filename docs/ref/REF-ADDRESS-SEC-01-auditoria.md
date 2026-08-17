# REF-ADDRESS-SEC-01 — Isolamento de `public.addresses`

Auditoria read-only, 17 ago 2026. Pré-requisito de segurança antes de [[REF-ADDRESS-UX-01]] (pausada).
Zero alteração de banco/código/deploy nesta fase. Espelho do artifact publicado na sessão.

## Achados confirmados

- Única policy em `public.addresses`: `"Auth all addresses" FOR ALL TO authenticated USING (true)
  WITH CHECK (true)`. `authenticated` tem grants diretos de SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
  REFERENCES/TRIGGER; `anon` não tem nenhum grant direto (só via RPC) — correção de precisão em
  relação ao relatório anterior.
- **Achado novo**: TRUNCATE não é filtrado por RLS no Postgres (é operação de tabela inteira, não de
  linha) — hoje qualquer cliente autenticado poderia apagar a tabela inteira com um comando.
- `customer_id` (FK → `customers`) nunca é populado: 0 de 22 linhas reais. `store_id` ausente em 8 de
  22 (cresceu de 5 — drift contínuo, fora desta REF, ver `REF-ADDRESS-STOREID-01`).
- `admin_order_endereco(p_order_id, p_store_id)` — a versão **realmente publicada** no banco (não a
  do arquivo de migration em disco, que está desatualizado) já é `SECURITY DEFINER` com
  `is_admin_of(p_store_id)` checado internamente — **ignora RLS por completo**. Admin não precisa de
  nenhuma policy nova nesta tabela.
- Identidade autenticada (`customer.id`) já está disponível em `CheckoutPage.jsx` exatamente onde o
  endereço é salvo — a correção do call-site é de 1 linha, sem plumbing novo.
- Zero código no frontend consulta `addresses` diretamente (`.from('addresses')`) — a única porta de
  entrada é a RPC `save_structured_address` (write-only).

## Achados incidentais (fora de escopo, só registrados)

- Arquivo `migrations/REF-COMANDA-ENDERECO-01-admin-order-endereco.sql` descreve uma versão
  desatualizada de `admin_order_endereco` (SECURITY INVOKER, sem `is_admin_of`) — a versão viva no
  banco é outra, mais segura. Documentação ficou para trás, comportamento real está correto.
- `create_order` aceita `endereco_id` cru do client sem checar posse — não vaza dado (a função não
  retorna endereço), mas permite um pedido apontar pra `addresses.id` de outra pessoa. Fora do escopo
  desta REF.

## Proposta (SQL exato, NÃO aplicado)

Migration em 2 partes independentes:

1. **Núcleo** — `DROP` da policy insegura, `REVOKE TRUNCATE/REFERENCES/TRIGGER`, 4 policies novas (uma
   por operação: SELECT/INSERT/UPDATE/DELETE), todas ancoradas em
   `customer_id IN (SELECT c.id FROM customers c WHERE c.auth_user_id = auth.uid())`; índice em
   `customer_id`. Sem cláusula de Admin (desnecessária — ver achado acima).
2. **Hardening complementar (opcional)** — `save_structured_address` passa a validar que o
   `customer_id` do payload realmente pertence à sessão atual (`auth.uid()`), gravando `NULL` caso
   contrário, em vez de confiar cegamente no valor enviado pelo client. Mesma assinatura, mesmo
   contrato de retorno.

Rollback completo e simétrico disponível (SQL no artifact). Nenhum dado alterado — só policies,
grants e a função. `store_id` não é tocado em nenhum ponto.

**Comportamento das 22 linhas legadas** (todas com `customer_id IS NULL`): ficam inacessíveis por RLS
para todo mundo após a correção — fail closed por construção, sem regressão porque nenhum código hoje
as lê via RLS (só via `admin_order_endereco`, que ignora RLS).

## Testes de RLS propostos (Fase 8, 14 cenários)

Script `BEGIN`→testes→`ROLLBACK` (zero mutação líquida), usando fixtures fictícias presas a UUIDs de
clientes reais existentes (nunca lê nome/telefone/PII) para simular sessões via
`set_config('request.jwt.claims', ...)`. Cobre: leitura/alteração/exclusão própria (permitida) vs.
alheia (negada), isolamento Encanto × Bar da Sogra nos 2 sentidos, `customer_id NULL` (visitante),
`anon` sem acesso, Admin via RPC (independente da RLS testada), hardening do RPC de escrita, checkout
guest inalterado. Script completo no artifact — pronto para rodar após aprovação, não executado ainda.

Artifact completo (design, tabelas, SQL formatado): link publicado na sessão.

## Fechamento (2026-08-17) — implementado, testado, aplicado, publicado e validado

**Aprovado pelo dono**: núcleo + hardening juntos. Migration aplicada em produção
(`hvbcdxsagkjtfjwvnslo`) exatamente como proposta. Estado final confirmado por leitura direta:
4 policies (`addresses_select/insert/update/delete_own`, todas ancoradas em `customer_id ->
customers.auth_user_id = auth.uid()`); grants de `authenticated` reduzidos a
`DELETE,INSERT,SELECT,UPDATE` (TRUNCATE/REFERENCES/TRIGGER confirmados revogados); `anon` com zero
grants (inalterado). `save_structured_address` hardened (só grava `customer_id` que pertence à
sessão autenticada atual; senão grava `NULL`) e continua `SECURITY DEFINER`.

**Testado** (BEGIN/ROLLBACK, zero mutação líquida, fixtures fictícias/sintéticas presas a UUIDs
reais, nunca lendo PII): 14 cenários de RLS — todos confirmados, incluindo os 2 que exigiram
correção do próprio desenho do teste (cenário 6 estava confundido por uma condição que dependia de
um UPDATE já negado; cenário 11 dependia de `RAISE NOTICE`, não capturado pela ferramenta usada —
ambos refeitos isoladamente e reconfirmados). Cenários 12/13 (Admin) precisaram de um admin
**sintético** store-scoped: o único admin real do banco também é `super_admin`, o que teria mascarado
o teste de negação cross-tenant (super_admin passa `is_admin_of()` de qualquer loja, por desenho —
não é bug). 5 cenários do RPC (A/B/C/E — D coberto pelos mesmos casos de B/C) confirmados via
inspeção do estado gravado (bypassando RLS só para leitura de verificação, nunca para os testes de
policy em si).

**Achado durante os testes**: um teste pré-existente (`scripts/address-schema-test.mjs`, caso `BA1`)
validava como esperado o comportamento ANTIGO e inseguro (`authenticated` genérico inserindo e lendo
qualquer linha) — corrigido para validar o oposto (fail closed). Também descobri, testando, que
`INSERT ... RETURNING` é sujeito à policy de `SELECT` (documentado do Postgres, não um bug) — sem
efeito em produção porque o RPC real bypassa RLS inteiramente (`SECURITY DEFINER`, dono `postgres`
com `rolbypassrls=true`).

**Regressão**: `test:domain` (suíte completa) verde. `test:db-guards` verde exceto a falha já
conhecida e pré-existente (`S4:addresses backfill`, drift de `store_id`, cresceu de 5 para 8 linhas
— fora desta REF). 2 builds (storefront + admin) verdes.

**Publicado**: commit `d211443`, `origin/main` = `d211443f5b8a0331d5013830758398b212fa973b`. Deploy
Vercel `dpl_3DNUVe2UJTnnk8pmBqxASfsLZ6Nf`, READY, alias de produção confirmada.

**Validado em produção**: bundle publicado inspecionado — `customerId` presente no chunk
`CheckoutPage-DXRMGnjP.js`, minificado mas reconhecível (`{...u,customerId:A.id}`). Estado final de
policies/grants reconfirmado por leitura direta pós-deploy. `route-distance` (REF-DELIVERY-FEE-03,
não tocada) re-testado com as mesmas coordenadas de sempre — resultado idêntico, sem regressão. Diff
do commit confirma zero arquivo de routing/fee/waterfall/confidence tocado.

**Limitações**: nenhum teste real de clique-a-clique no navegador contra produção (evitado por
criar pedido real); a prova de Admin cross-tenant usou um admin sintético (o único real é super
admin); as 22→ linhas legadas (sempre `customer_id NULL`) seguem inacessíveis por RLS para todo
mundo, por desenho (fail closed, não é regressão).

**Follow-ups**: `REF-ADDRESS-STOREID-01` (drift de `store_id`, agora 8 linhas) continua separada, não
tocada. `REF-ADDRESS-UX-01` (histórico de endereços) está desbloqueada — todos os critérios da Fase 9
foram atendidos — mas permanece pausada até autorização explícita para retomar.

**STATUS FINAL: REF-ADDRESS-SEC-01 = FECHADA (2026-08-17).**
