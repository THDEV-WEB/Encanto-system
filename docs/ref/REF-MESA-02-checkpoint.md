# REF-MESA-02 — CHECKPOINT (ler primeiro numa nova sessão/retomada)

**Atualizado:** 2026-09-05, após commit `cc779c0` (Onda 4 concluída). Execução autônoma noturna
autorizada pelo dono do produto (2026-09-05, "quero ir dormir... deixar vc trabalhando a noite
toda") — sem pausa obrigatória entre ondas. Hard constraints seguem valendo integralmente: nunca
produção, nunca push, nunca reescrever histórico, 1 commit por subfase com `git add` explícito
(nunca `-A`/`.`), nunca tocar arquivo de outra sessão em andamento, parar de verdade só nos 8 STOP
conditions (perda de dado, tocar produção, conflito arquitetural irresolúvel, risco de vazamento
entre lojas, decisão de negócio fora do já decidido, arquivo de outra sessão, reescrever histórico,
falha de segurança séria).

**Se retomando após um corte**: rode `git log --oneline -15` e `git status --porcelain=v1` em
`C:\Projetos\Encanto\encanto-react` ANTES de qualquer coisa. Não repita trabalho já commitado.

## Estado do git (neste checkpoint)
```
cc779c0 ref(mesa-02): implementa catalogo de mesas fisicas + aba Admin       <- Onda 4
2c4da86 ref(mesa-02): adiciona relacao orders.mesa_session_id                <- Onda 3
b2d1ef8 ref(mesa-02): cria fundacao de mesa_sessions                         <- Onda 2
96724b9 docs(mesa): REF-MESA-02 Onda 1 -- precheck (BLOQUEADO, depois resolvido)
c076591 ref(mesa-02): reconcilia REF-MESA-01 com REF-DELIVERY-FEE-05
475cfef docs(mesa): REF-MESA-02 Onda 0 -- auditoria completa
```
Todos LOCAIS, `origin/main` não avançou (ainda só `e972e1a`, ver `encanto-ref-mesa-01.md`). Working
tree sempre tem 2 arquivos de OUTRAS sessões (nunca tocar): `src/constants/privacyPolicy.js`
(modificado) e `scripts/loadtest-e2e.mjs` (untracked). Outras sessões seguem ativas neste mesmo
repo (REF-DELIVERY-FEE-05 chegou até a Onda 3 hoje) — sempre `git status`/checar drift antes de
tocar `create_order()`/`admin_orders_search()`/`_resolve_delivery_fee()` de novo.

## O que já existe (não recriar)
- **mesa_sessions** (Onda 2): estado da conta (aberta/fechada), sem coluna escalar de mesa.
- **mesa_session_mesas** (Onda 2): associação N:1 mesa física↔sessão — suporta junção de mesas
  desde a fundação. Índice único parcial `(store_id, mesa_identificador) WHERE status_sessao='aberta'`
  é o mecanismo central de concorrência.
- **orders.mesa_session_id** (Onda 3): FK nullable, imutável uma vez gravada, cross-tenant
  validado por trigger. `create_order()` AINDA NÃO grava nada nela (onda futura).
- **public.mesas** (Onda 4): catálogo físico por loja (`identificador`, `status`
  disponível/indisponível). "Ocupada" é sempre derivada de `mesa_session_mesas`, nunca persistida.
  RPCs: `admin_listar_mesas`/`admin_criar_mesa`/`admin_set_mesa_status`. Aba "Mesas" no Admin
  (`AdminMesas.jsx` + `mesasFisicas.js`) já existe e funciona (cadastrar/listar/toggle status).
- **create_order()/admin_orders_search()**: reconciliados (Onda 8 da MESA-01) — têm Mesa (Onda 1
  da MESA-01) E `adicional_pagamento_fee` (DELIVERY-FEE-05) juntos. Ainda NÃO resolvem
  `mesa_session_id` (isso é onda futura: "create_order() resolve mesa_session_id").

## Suítes de teste ativas (rodar sempre antes de commitar qualquer onda nova)
```
scripts/mesa-01-onda1-fundacao-test.mjs         26/26
scripts/mesa-01-onda3-canal-qr-test.mjs          8/8
scripts/mesa-01-onda4-canal-admin-test.mjs       8/8
scripts/mesa-01-onda5-admin-orders-search-test.mjs 4/4
scripts/mesa-01-onda6-admin-reports-test.mjs     5/5
scripts/mesa-01-onda7-notificacoes-test.mjs      9/9
scripts/mesa-01-onda8-reconciliacao-test.mjs    10/10
scripts/mesa-02-onda2-fundacao-test.mjs         27/27
scripts/mesa-02-onda3-orders-fk-test.mjs         8/8
scripts/mesa-02-onda4-mesas-fisicas-test.mjs    11/11
scripts/delivery-fee-05-onda1-onda2-test.mjs    29/29
npm run test:domain                             verde
```
Total: 145 checks de banco + domain suite. Banco-alvo: SOMENTE `C:/Users/00thi/.encanto/db.e2e.env`
(bgzcro), NUNCA `db.env`/produção.

## Lições aprendidas HOJE sobre os próprios scripts de teste (não repetir)
1. Dado criado dentro de um `withSavepoint()` some no `ROLLBACK TO SAVEPOINT` daquele bloco — nunca
   depender dele em um bloco posterior. Crie fora de qualquer savepoint o que precisa sobreviver.
2. `expectError()`/qualquer captura de exceção esperada PRECISA rodar num savepoint aninhado próprio
   e só fazer `ROLLBACK TO SAVEPOINT` quando HOUVE erro (nunca no sucesso, senão desfaz o efeito que
   os checks seguintes esperam ver).
3. Ao pegar 2 usuários de `auth.users` para simular "admin" vs "outsider": `LIMIT 2`, não `LIMIT 1`
   (bug real cometido na Onda 4 — `LIMIT 1` faz a 2ª identidade colapsar na 1ª silenciosamente).
   Para um outsider "sem NENHUM vínculo admin", prefira um `sub` totalmente novo (`randomUUID()`),
   não uma linha real de `auth.users` que pode legitimamente ganhar vínculo em outro caso do mesmo
   arquivo.

## PRÓXIMO PASSO EXATO — Onda 5: QR protegido

Esta é a onda de segurança mais crítica de toda a REF (resolve R3, o achado mais grave da
auditoria: `mesa_identificador` previsível sem prova de posse). Autorização explícita já dada
(seção 9 da instrução mestre): **implementar token/nonce seguro, NÃO confiar em `?mesa=numero` cru**.

Requisitos exatos:
- Token não previsível, não sequencial, não derivado do número da mesa.
- Validado server-side. Associado ao tenant/store correto. Impede cross-tenant.
- Número da mesa pode continuar visível na UI, mas NÃO é credencial.
- Fluxo: validar token → resolver mesa → validar loja → validar disponibilidade → resolver/criar
  sessão → associar pedido → **nunca deixar campos do client substituir a mesa resolvida pelo token**.

Decisão de design a tomar (não determinada por nenhum documento ainda — decidir e documentar,
não parar): onde o token vive. Duas opções razoáveis:
(a) coluna `mesas.qr_token` (uuid ou texto aleatório longo, `UNIQUE`, gerado no `admin_criar_mesa`
    já existente ou por uma RPC nova `admin_gerar_qr_token`), URL vira `?mesa_token=<token>` (não mais
    `?mesa=<identificador>`);
(b) tabela separada de tokens (permite rotação/múltiplos tokens por mesa no futuro) — mais flexível,
    mais complexo; **provavelmente desnecessário agora** (YAGNI) dado que trocar de mesa/juntar mesas
    já foi resolvido na camada de sessão (Onda 2), não na camada de mesa física.
Recomendação: (a), simples, direto, já há a tabela `mesas` da Onda 4 pronta para receber a coluna.
Gerar com `encode(gen_random_bytes(18), 'base64url')`-equivalente ou `gen_random_uuid()` (mais simples,
122 bits de entropia, já é o padrão de todo o resto do projeto — prefira isso a menos que haja razão
concreta para mais entropia).

RPC nova a considerar: `resolver_mesa_por_token(p_token) RETURNS jsonb` (público, SECURITY DEFINER,
sem exigir auth — é o que o cliente escaneando o QR vai chamar) — resolve `store_id`+`mesa_identificador`
a partir do token, fail-closed genérico se inválido (nunca revelar se o token "quase" existe).

Depois da Onda 5, seguir literalmente a ordem do plano mestre (mensagem do dono, seção 32):
Onda 6 (abertura implícita da sessão) → 7 (Admin/novo pedido) → 8 (total/consulta) → 9 (troca de
mesa) → 10 (junção de mesas) → 11 (fechamento) → 12 (relatório/reconciliação) → 13 (fidelidade,
só testes) → 14 (notificações) → 15 (impressão QR) → 16 (segurança/ataque) → 17 (regressão completa).

Fluxo de sempre, sem pular etapa: investigar/decidir → migration+rollback → aplicar SOMENTE E2E →
testar (backend E2E + regressão completa de TODAS as suítes acima, sempre) → frontend quando a onda
pedir → lint/typecheck/build → documentar (`docs/ref/REF-MESA-02-ondaN-<slug>.md`) → `git add`
explícito (nunca `-A`) → commit → **atualizar este checkpoint** → próxima onda, sem pausa.
