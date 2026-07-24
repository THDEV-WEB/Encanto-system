# REF-CI-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida (limite, queda, sessão encerrada), retomar
EXCLUSIVAMENTE a partir daqui — não repetir auditoria já concluída abaixo.

**Contexto:** REF-ADMIN-03 concluída integralmente nesta mesma sessão (3/3 ondas, 104/104 E2E, sem
regressão) — NÃO commitada ainda, aguardando revisão do dono. REF-CI-01 inicia por cima dessas
mudanças ainda não commitadas (working tree), conforme autorização do dono.
**Regra do dono para esta REF:** executar tudo nesta sessão, apresentar relatório final, **NÃO
commitar nem dar push** — aguardar aprovação em revisão posterior (amanhã).

## Estado atual

✅ REF-CI-01 CONCLUÍDA INTEGRALMENTE (3/3 ondas), validação final 100% verde. Aguardando ADR +
relatório técnico final e aprovação do dono. **NÃO commitar/dar push** (nem o workflow, que só
passa a valer depois do 1º push mesmo assim).

## Onda 1 — Build + testes de domínio

Status: ✅ CONCLUÍDA. `.github/workflows/ci.yml` (jobs `build`+`domain-tests`, paralelos, sem
segredos). Novo script `test:domain` em `package.json` (agrega os ~26 scripts). Testado localmente:
26/26 verdes.

## Onda 2 — E2E no CI

Status: ✅ CONCLUÍDA. Job `e2e` no mesmo workflow — Playwright contra o projeto Supabase DEDICADO de
testes (nunca produção), com `.env.e2e` gerado a partir de 3 secrets do GitHub. Sem os secrets
cadastrados, o job roda igual (mecanismo de degradação já existente desde a REF-E2E-01) — só com
cobertura reduzida. YAML validado sintaticamente (`js-yaml` via npx, efêmero); mecanismo de
"secrets vazios" testado isoladamente (`createClient('','')` lança sincronamente, capturado pelo
try/catch existente). Incidente auto-contido durante a validação (processo Vite remanescente na porta
5183) identificado e limpo; `.env.e2e` real restaurado e revalidado com 2 specs específicos.

## Onda 3 — Organização, cache, badge, documentação

Status: ✅ CONCLUÍDA. `test:db-guards` (agregação LOCAL dos 6 guards de produção — fora do CI
automático, decisão de segurança). Cache nativo do `setup-node` (npm) + `actions/cache` para binários
do Playwright. Badge de CI no `README.md` raiz. `permissions: contents: read` + `concurrency`
(cancela runs supersedidos). ADR + seção do `e2e/README.md` atualizada.

## Arquivos modificados

- `.github/workflows/ci.yml` (novo)
- `package.json` — 2 scripts novos (`test:domain`, `test:db-guards`)
- `README.md` — badge de CI
- `e2e/README.md` — seção "CI (GitHub Actions)" atualizada (existia como nota "ainda não criado")
- `docs/adr/REF-CI-01-pipeline.md` (novo)
- Nenhum arquivo de `src/` alterado — zero superfície de regressão em runtime.

## VALIDAÇÃO FINAL (local, pré-push)

- ✅ 3/3 ondas concluídas
- ✅ Documentação atualizada (ADR + progress.md + e2e/README.md + badge)
- ✅ Sintaxe do workflow validada (`js-yaml`)
- ✅ `npm run build`: limpo
- ✅ `npm run test:domain`: 26/26
- ✅ `npm run test:e2e` (suíte completa, reexecutada após todas as mudanças): **104/104**
- ✅ `test:rls`/`test:orders-rls`/`test:auth-rls`: 100% verde, zero escrita persistida
- ✅ Zero regressões (nenhum arquivo de runtime tocado)

## Validação REAL no GitHub Actions (pós-aprovação e push do dono)

**Commits:** `cfbd1a0` (push inicial, 19 commits incl. REF-ADMIN-01/02/03+CI-01) → `a811f02` (reporter
`github` p/ diagnóstico) → `869caf3` (fix: fallback de URL/key p/ secrets ausentes) → `1c0a908` (commit
vazio, redispara após dono cadastrar os 3 secrets) → `56cd80b` (fix: 2 flakes revelados só em CI).

| Run | Commit | Build | Domain | E2E | Causa/fix |
|---|---|---|---|---|---|
| 30088596312 | cfbd1a0 | ✅ | ✅ | ❌ 17 falhas (21.7min) | secrets ausentes → `createClient('','')` lança sync → `db`/`dbCliente` null |
| 30092729757 | a811f02 | ✅ | ✅ | ❌ 17 falhas (22.0min) | mesma causa; reporter `github` adicionado só p/ diagnóstico (annotations públicas) |
| 30095359329 | 869caf3 | ✅ | ✅ | ❌ 10 falhas (15.6min) | fallback de URL/key resolveu os 7 testes de login; restam os que precisam do catálogo REAL (secrets nunca configurados no repo) |
| 30106607464 | 1c0a908 | ✅ | ✅ | ❌ 2 falhas (6.2min) | dono cadastrou os 3 secrets reais — tempo já bate com local; sobraram 2 flakes genuínos de CI |
| 30108030526 | 56cd80b | ✅ | ✅ | ❌ 1 falha infra (1.3min) | `actions/checkout@v4` não baixou (429 Too Many Requests do próprio GitHub) — nada a ver com código; corrigido os 2 flakes de teste (imagem + reconciliação de horário) neste commit mesmo assim |
| 30108185031 | 8b7b486 | ✅ | ✅ | ❌ 1 falha (5.8min) | redisparo após o 429 — imagem OK agora, mas "loja fechada" falhou de novo: botão ficou "enabled" nas 64 tentativas ao longo dos 30s inteiros (não é lentidão, é ausência total de reconciliação) |
| 30109244656 | 7927d13 | ✅ | ✅ | **✅ 104/104 (2.6min)** | causa raiz real: `forcarStoreMode()` lia credenciais de `C:\Users\...\db.e2e.env` (arquivo LOCAL do Windows, inexistente em CI) — virava no-op silencioso; reescrito para usar `supabaseAdmin()` (mesma infra que já funciona nos 2 ambientes) |

**Achado real de edição:** ao aplicar o fix da Onda de imagem (run 30106607464), um `Edit` acidentalmente
removeu as linhas de login/navegação do teste (old_string/new_string mal recortados) — pego
imediatamente pela própria suíte local (timeout esperando um elemento que nunca apareceria sem login),
corrigido antes do commit.

**Achado real mais profundo (o que realmente fechou o pipeline):** o timeout ampliado (15s→30s) em
`checkout-guest.spec.js` NÃO era a causa raiz — era só uma correção de sintoma que não resolveu nada
(o botão nunca mudava de estado, não importa quanto se esperasse). A causa raiz de verdade era
`e2e/support/storeMode.js` (helper de setup, escrito na REF-E2E-01, antes de qualquer CI existir)
depender de uma conexão Postgres direta com credenciais lidas de um arquivo local do Windows —
silenciosamente virava no-op em CI, deixando o `store_mode` do banco compartilhado com o valor residual
de execuções locais anteriores, nunca de fato "CLOSED". Reescrito para usar `supabaseAdmin()` (REST,
service_role, já usado por toda a suíte e já configurado via secrets do GitHub) — elimina a dependência
de arquivo local por completo.

## ESTADO FINAL

✅ **Pipeline 100% verde** — run [30109244656](https://github.com/THDEV-WEB/Encanto-system/actions/runs/30109244656):
Build ✅ (0.3min) · Domain-tests ✅ (0.3min) · E2E ✅ **104/104** (2.6min). Zero falhas, zero warnings
críticos (só o aviso de depreciação do Node 20 nas actions, infraestrutura do GitHub). REF-CI-01
totalmente operacional e validada de ponta a ponta com execução real.
