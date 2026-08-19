# REF-SEC-DATA-01 — Auditoria de proteção e exposição de dados de clientes

Auditoria completa (2026-08-17), somente-leitura na fase inicial, pedida pelo dono cobrindo a cadeia
inteira cliente → frontend → autenticação → API/Supabase → banco → storage → logs → admin → RPCs →
backups. Relatório completo (20 seções, matriz de risco, 9 cenários de invasão) publicado como
artifact: https://claude.ai/code/artifact/4a2dc13b-ef77-4bed-bb48-1544a227a3d3 (zero PII real no
relatório, só estrutura/contagens).

19 achados classificados (R1–R19). R15/R16 são informativos por desenho, não pendência. Este documento
é o registro vivo do que foi corrigido, quando, e por quê — companheiro do artifact original, que fica
congelado como fotografia do dia da auditoria.

## Rodada 1 (2026-08-17) — Críticos: R1 + R2 + R3 + R7 — APLICADOS EM PRODUÇÃO

- **R1** `purge_old_logs` / **R2** `reconcile_orders`/`reconcile_and_alert` / **R7**
  `check_alert_thresholds` — 4 funções `SECURITY DEFINER` cron-only com `EXECUTE` concedido a
  `authenticated` sem nenhum guard de autorização. Corrigido: `REVOKE EXECUTE ... FROM authenticated`
  nas 4 (cron roda como `postgres`, dono das funções, EXECUTE implícito preservado).
- **R3** `GRANT TRUNCATE/REFERENCES/TRIGGER` amplo a `anon`+`authenticated` em ~18 tabelas do schema
  `public` (incluindo `admins`/`super_admins`) + causa raiz no `ALTER DEFAULT PRIVILEGES` do role
  `postgres` (tabela nova nasceria com o mesmo buraco).

Migration: `migrations/REF-SEC-DATA-01-harden-critical.sql` (+rollback). Teste:
`npm run test:sec-data-01` (12/12). Commits `b9f44d9` + `e77bdd8` (fix colateral de um script de teste
pré-existente que chamava `reconcile_orders()` como `authenticated` só como utilitário de setup).

## Rodada 2 (2026-08-17, mesmo dia) — Altos: R5 + R6 + R8 — APLICADOS EM PRODUÇÃO

- **R5** `application_logs` com `SELECT` aberto a `authenticated` sem filtro de `store_id` → policy
  trocada para `is_admin_of(store_id)`. INSERT continua aberto a `anon` de propósito (fallback legítimo
  de catálogo em `useProducts.js` quando o Supabase cai, roda para visitante anônimo também).
- **R6** `trg_customer_audit` gravava em `order_events` sem `store_id` explícito → caía sempre na loja
  Encanto (`default_store_id()`), vazando PII individual (nome/telefone antes/depois) de clientes de
  OUTRAS lojas para o admin da Encanto. Corrigido: propaga `new.store_id`, mesmo padrão já correto dos
  outros triggers de auditoria.
- **R8** 5 RPCs `admin_*` com `EXECUTE` concedido também a `anon`/`PUBLIC` (já gated internamente por
  `is_admin_of`, mas fora do padrão de defesa em profundidade do projeto) → `REVOKE ... FROM PUBLIC,
  anon`.

Migration: `migrations/REF-SEC-DATA-01-harden-r5-r6-r8.sql` (+rollback). Teste: `npm run
test:sec-data-01-r5r6r8` (13/13). Commit `1228ede`.

## Rodada 3 (2026-08-18) — R9 + R12 + R13 + R14 + R17 + R18 + R19

R4/R10/R11 (isolamento cross-tenant de `addresses`) tratados à parte em
`docs/ref/REF-AUTH-TENANT-01-auditoria.md` — mesma causa raiz, correção arquitetural maior (Custom
Access Token Hook), conduzida em sessão separada.

### R18 — bucket `products` sem limite — APLICADO E VALIDADO
`file_size_limit`/`allowed_mime_types` eram `NULL`. Políticas de `storage.objects` já exigiam
`is_admin_of(store_id)` para upload (não era aberto a qualquer `authenticated`) — hardening de defesa
em profundidade, espelhando exatamente a validação já existente no client
(`src/components/admin/ImageUploader.jsx`: 5MB, jpeg/png/webp/gif).

### R19 — 3 funções sem migration versionada — APLICADO E VALIDADO
`get_setting`, `normalize_phone`, `send_alert` existiam em produção mas nunca tiveram `CREATE FUNCTION`
nos 138 arquivos de `migrations/` do repo (criadas via SQL Editor antes da disciplina de migration do
projeto). Corpo capturado via `pg_get_functiondef` e reproduzido byte a byte via `CREATE OR REPLACE` —
zero mudança de comportamento, só fecha o gap de reprodutibilidade.

### R9 — `pg_net` EXECUTE amplo — **NÃO CORRIGÍVEL PELO ROLE DISPONÍVEL NO SUPABASE GERENCIADO; RISCO RESIDUAL ACEITO**
`anon`/`authenticated` têm `EXECUTE` real em `net.http_get`/`net.http_post` (confirmado via
`has_function_privilege`). O `REVOKE` foi tentado na mesma migration de R18/R19 e **rodou sem erro, mas
foi um no-op silencioso** — confirmado por introspecção pós-aplicação que os grants continuam intactos.

Causa raiz, confirmada por query direta: o schema `net` (extensão `pg_net`) pertence ao role
`supabase_admin`. O role `postgres` — o único role de banco disponível no projeto — **não é superuser,
não é membro de `supabase_admin`, e `SET ROLE supabase_admin` retorna "permission denied"**. `REVOKE`
exige ser dono do objeto, ter `GRANT OPTION`, ou ser superuser — nenhuma das três condições se aplica.
Isso é uma restrição de plataforma do Supabase gerenciado (que reserva `supabase_admin` para si mesma),
não um erro de sintaxe nem algo contornável via SQL Editor de nenhuma forma.

**Mitigantes que sustentam a decisão de aceitar como risco residual** (não corrigido, mas também não
ignorado):
- Schema `net` não é exposto pela API REST do PostgREST — não há rota `POST /rest/v1/rpc/http_post`
  nem equivalente; exploração exigiria acesso direto ao Postgres (credencial de banco vazada, um
  incidente maior e independente deste achado).
- As únicas 2 funções do projeto que chamam `net.*` (`enc_dispatch_notifications`, `send_alert`) são
  `SECURITY DEFINER` de dono `postgres`, chamadas via `pg_cron` como `postgres` — já restritas por si
  só, não dependem do grant de `net.*` para `anon`/`authenticated` estar fechado.

**Eventual correção depende de intervenção do suporte da plataforma Supabase** (só eles têm acesso ao
role `supabase_admin`) — não é algo que o projeto consiga resolver sozinho. Decisão do dono
(2026-08-18): aceitar como está, não abrir chamado de suporte por ora, dado o risco prático já ser
baixo.

### R13 — Edge Function `whatsapp-notify` órfã — APLICADO
Confirmado morta: nenhuma chamada real (frontend, migration, cron) — o envio de produção roda via
`pg_net`+`pg_cron` direto no Postgres desde REF-ORDER-01b. Removida (`index.ts`, `templates.ts`,
`README.md`) + comentários desatualizados corrigidos em `WhatsAppService.js`/`messageTemplates.js`/
`routeDistanceService.js`/`route-distance/index.ts` + 2 checagens de paridade JS×Edge-Function removidas
dos golden tests (não há mais 2ª cópia para manter em sincronia).

### R14 — `route-distance` sem guard de auth — MITIGADO
Não exige sessão de usuário real por decisão de desenho preexistente e documentada (mesmo padrão de RPC
pública via anon key) — preservada. Risco real era só exaustão da cota diária do HeiGIT (2.000 req/dia),
nunca PII. Adicionado rate-limit de 30 req/min por IP, só na chamada real ao provedor (nunca em cache
hit).

### R17 — `console.log` vazando PII para breadcrumb do Sentry — APLICADO
`Sentry.init` já capturava `console.*` como breadcrumb por padrão, sem filtro, anexando a qualquer erro
reportado depois. Removidos 3 `console.log` de depuração que logavam o carrinho inteiro (produto,
adicionais, observação livre do cliente). Defesa em profundidade: `beforeBreadcrumb` agora descarta toda
a categoria `'console'`, fechando a causa raiz para qualquer log futuro, não só os 3 pontos achados.

### R12 — logout não limpava endereço/carrinho — APLICADO
Dispositivo compartilhado herdava endereço e carrinho completos do cliente anterior. Corrigido em
`StoreApp.jsx`: detecção da transição real de sessão `'logged' → 'anon'` (nunca do snapshot atual, para
não afetar o carrinho de um visitante que nunca logou).

**Migrations/scripts desta rodada**: `migrations/REF-SEC-DATA-01-harden-r9-r18-r19.sql` (+rollback),
`scripts/sec-data-01-r9-r18-r19-test.mjs` (`npm run test:sec-data-01-r9r18r19`). Commits `2ab7560`,
`a2e0c4c`, `97308f7`, `cd332b8`, `2cb0d21`, `d582c9e`.

## FECHAMENTO (2026-08-19) — Rodada 3 encerrada, aprovado pelo dono

As 3 validações manuais pendentes foram concluídas:

- **R13 (secrets do WhatsApp)** — verificados via `supabase secrets list --project-ref
  hvbcdxsagkjtfjwvnslo`: nenhum secret órfão (`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/
  `WHATSAPP_API_VERSION` nunca chegaram a ser configurados na Edge Function removida — só existiam no
  Vault, usado pelo path real via `pg_net`/`pg_cron`). Nada a remover.
- **R14 (deploy do `route-distance`)** — deploy confirmado em produção via `supabase functions deploy`:
  projeto `hvbcdxsagkjtfjwvnslo`, versão publicada `2`, status `ACTIVE`. Validação pós-deploy: chamada
  HTTP real (`POST /functions/v1/route-distance` com a anon key pública) retornou `200` com resposta
  válida (`{"distanceKm":1.9645,"durationMin":5.18,"provider":"heigit","cached":false}`) — confirma
  ausência de regressão no caminho normal. O bloqueio de deploy encontrado antes era o classificador de
  auto mode do ambiente (não um erro do código/migration) — resolvido com uma permissão explícita
  adicionada ao `settings.local.json`. `supabase functions download` (usado numa tentativa de comparar
  o código publicado byte a byte) continua bloqueado pelo mesmo classificador — não é pendência da REF,
  pois não é necessário para comprovar deploy/funcionamento (a validação funcional acima já basta).
- **R12 (smoke test de logout)** — em vez de clique manual, escrito e rodado
  `e2e/tests/cliente/logout-limpa-endereco-carrinho.spec.js` contra o ambiente de E2E real (login/sessão
  genuínos): **2/2 PASS** — confirma que endereço e carrinho são limpos na transição real de logout, e
  que o carrinho de um visitante nunca-logado não é afetado.

**R18/R19**: 100% verdes (`npm run test:sec-data-01-r9r18r19`, 5/5 PASS após corrigir 2 bugs do próprio
script de teste — comparação de `file_size_limit` como string vs number, e normalização de line endings
`\r\n`/`\n` no corpo de função capturado via SQL Editor).

**R9**: mantido como **risco residual aceito** — não corrigível pelo role disponível no Supabase
gerenciado (`postgres` não é dono/membro/superuser sobre os objetos da extensão `pg_net`, que pertence a
`supabase_admin`). Nenhuma alteração adicional necessária ou planejada para R9; eventual correção
dependeria de intervenção do suporte da própria plataforma Supabase.

**REF-SEC-DATA-01 está FORMALMENTE FECHADA.** As 3 rodadas de correção (críticos, altos, e os 7 achados
menores desta rodada) estão aplicadas e validadas em produção, com exceção do R9 (residual aceito) e
R4/R10/R11 (tratados à parte). Nenhum achado novo foi aberto no processo de fechamento.

## Não corrigidos nesta REF (fora de escopo, registrados)

- **R4/R10/R11** — isolamento cross-tenant de `addresses`/`link_customer_to_auth`. Tratados em
  `docs/ref/REF-AUTH-TENANT-01-auditoria.md`.
- **R9** — risco residual aceito, limitação de plataforma (ver seção FECHAMENTO acima).
- **R15/R16** — informativos por desenho, não são pendência.
