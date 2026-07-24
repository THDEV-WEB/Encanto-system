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

## VALIDAÇÃO FINAL

- ✅ 3/3 ondas concluídas
- ✅ Documentação atualizada (ADR + progress.md + e2e/README.md + badge)
- ✅ Sintaxe do workflow validada (`js-yaml`)
- ✅ `npm run build`: limpo
- ✅ `npm run test:domain`: 26/26
- ✅ `npm run test:e2e` (suíte completa, reexecutada após todas as mudanças): **104/104**
- ✅ `test:rls`/`test:orders-rls`/`test:auth-rls`: 100% verde, zero escrita persistida
- ✅ Zero regressões (nenhum arquivo de runtime tocado)
- ⚠️ Workflow NÃO disparado de verdade no GitHub (exigiria push — fora do escopo; validação foi via
  parsing sintático + execução manual de cada step)

**PRÓXIMO PASSO:** apresentar relatório técnico final. Aguardar revisão do dono amanhã antes de
qualquer commit/push (REF-ADMIN-03 e REF-CI-01 seguem ambas pendentes de commit nesta sessão).
