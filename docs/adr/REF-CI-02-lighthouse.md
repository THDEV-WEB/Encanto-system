# REF-CI-02 — Lighthouse CI

**Status:** ✅ Implementada e validada localmente (2026-08-22) — job novo `lighthouse` no pipeline
existente. Motor de auditoria (Lighthouse) confirmado funcionando via CLI direta, 2 rodadas (Edge
headless como stand-in do Chrome, ausente neste ambiente Windows). O `lhci autorun` completo (healthcheck
+ collect + upload) não pôde ser confirmado ponta a ponta NESTA máquina — ver §Verificação local para
o motivo exato (bug de terceiros, específico do Windows). Aguardando aprovação do dono para o commit/push.
**Depende de:** REF-CI-01 (pipeline existente, 4 jobs paralelos), REF-E2E-01 (projeto Supabase
dedicado a testes e seus secrets, já cadastrados no repositório para o job `e2e`).
**Escopo:** só o job de Lighthouse. A 2ª metade do item original do roadmap (levar `test:db-guards`
para o CI) foi decidida como FORA de escopo — ver §Decisão.

## Origem e escopo real (achado que mudou o plano)

O roadmap paralelo (`encanto-roadmap-paralelo-saas01`, 08/08) descrevia REF-CI-02 como "Lighthouse CI
+ levar test:db-guards pro CI via projeto E2E". Ao reabrir esta frente, a auditoria do próprio
`docs/adr/REF-CI-01-pipeline.md` mostrou que essa premissa está desatualizada: os 6 guards de banco
que compõem `test:db-guards` (hoje 30 scripts, cresceu com SAAS-01/02, LGPD, SEC-DATA-01 etc.)
conectam **direto em produção** (`db.env` local), não no projeto E2E — e a CI-01 já tinha decidido
deliberadamente NÃO automatizar isso, por expor credencial de produção a um workflow que roda em todo
push/PR. A recomendação que ficou registrada foi um 2º workflow `workflow_dispatch` (manual, sob
demanda), condicionado ao dono cadastrar o secret de produção — ação que só ele pode tomar.

Apresentada a escolha, o dono optou por fazer **só o Lighthouse CI agora**, mantendo intocada a
decisão de segurança da CI-01. O workflow manual para os guards de produção fica registrado como
proposta futura, não iniciado.

## Decisão — contra o quê medir

Testado empiricamente antes de decidir (não por suposição):

| Cenário | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| Build sem credenciais (estado degradado, `db=null`) | **27** | 95 | 100 | 100 |
| Build com credenciais do projeto E2E (catálogo fixture real) | **74** | 100 | 100 | 100 |
| Referência: produção real, 38 produtos (REF-PERF-01, 08/2026) | 68 | — | — | — |

Medir sem credenciais reportaria um score quase 3× pior que o real, mascarando qualquer regressão de
código atrás desse ruído. Por isso o job `lighthouse` reaproveita os MESMOS secrets já cadastrados no
repositório para o job `e2e` (`E2E_SUPABASE_URL`/`E2E_SUPABASE_ANON_KEY`, projeto dedicado a testes,
nunca produção) — mesmo padrão de degradação graciosa já usado ali: sem os secrets, cai no fallback
fictício e mede a home vazia, mas o job não fica vermelho por isso.

O número do CI (~74, catálogo fixture menor) não é diretamente comparável ao número de produção (68,
catálogo real maior com imagens até 2,1MB) — são ambientes diferentes por natureza. Por isso **não há
`assert`/threshold bloqueante nesta REF**: o objetivo é só estabelecer a infraestrutura de medição e
histórico (relatório sobe como artifact do run). Thresholds reais ficam para a REF-PERF-02 decidir,
com uma baseline medida DENTRO do CI — não a de produção.

## Implementação

- `lighthouserc.cjs` (raiz): configura o `@lhci/cli` (`npx --yes @lhci/cli@0.14.x autorun`, efêmero,
  mesmo padrão já usado para `js-yaml` na CI-01 — sem virar dependência do projeto). `startServerCommand`
  sobe o próprio `npm run preview` e o `@lhci/cli` derruba sozinho ao final; mobile + throttling
  simulado, mesma metodologia da REF-PERF-01 (reprodutível run a run, não depende da CPU/rede do
  runner). `upload.target: filesystem` — relatório fica local (`.lighthouseci/`), sobe como artifact
  do GitHub Actions (mesmo padrão do `playwright-report` do job `e2e`), nunca em storage público de
  terceiros.
- `.github/workflows/ci.yml`: novo job `lighthouse`, 5º job independente (rodam todos em paralelo, sem
  `needs:` entre eles, mesmo padrão dos outros 4). Passos: checkout → node 24 → `npm ci` → escreve
  `.env` com as credenciais do E2E (mesmo mecanismo de fallback do job `e2e`) → `npm run build` →
  `npx @lhci/cli autorun` → upload do relatório (`if: always()`, quer passe ou falhe, já que não há
  threshold que "falhe" o job hoje).

## Verificação local

Sem Chrome instalado nesta máquina Windows — usado Microsoft Edge (mesmo motor Chromium) via
`CHROME_PATH`, mesmo estratagema já documentado na REF-PERF-01. Em CI de verdade (`ubuntu-latest`) o
Chrome já vem pré-instalado na imagem do runner, sem necessidade desse contorno.

- `npm run build` + `npm run preview`: build limpo, servidor responde 200 em `/encanto/`.
- Lighthouse standalone (CLI direta, output para arquivo) contra o build SEM credenciais:
  27/95/100/100 (perf/a11y/bp/seo) — confirma o risco que motivou usar os secrets do E2E.
- Lighthouse standalone contra o build COM credenciais do projeto E2E: 74/100/100/100. As duas rodadas
  confirmam que o MOTOR de auditoria (config `formFactor`/`throttlingMethod`/`onlyCategories`, a mesma
  usada no `lighthouserc.cjs`) funciona corretamente e produz números plausíveis.
- `npx @lhci/cli autorun --config=./lighthouserc.cjs`: healthcheck passa (`.lighthouseci/` gravável,
  config encontrada, Chrome encontrado). A fase de `collect` roda a auditoria completa até o fim
  ("Generating results...", todas as categorias auditadas) mas o subprocesso do Lighthouse trava numa
  exceção NÃO capturada ao tentar apagar seu próprio diretório temporário do Chrome ao encerrar —
  `chrome-launcher` lança `EPERM` nesse cleanup, bug catalogado da biblioteca especificamente no
  Windows (permissão de arquivo/antivírus prendendo a pasta), não relacionado a este código. Como o
  subprocesso morre depois de gerar os resultados mas antes de devolvê-los ao `lhci`, a fase de
  `upload` não chega a rodar NESTA máquina — `.lighthouseci/` não é criado. Em `ubuntu-latest` (o
  runner real do CI) essa classe de bug do `chrome-launcher` não se manifesta; combinado com o motor
  já confirmado funcionando via CLI direta, a expectativa é de que `autorun` complete normalmente em
  CI. Registrado como risco residual: só o 1º run real no GitHub Actions confirma isso de ponta a
  ponta (mesma limitação, aliás, que a própria REF-CI-01 já registrou para seus 4 jobs — nenhum deles
  foi disparado de verdade antes do 1º push).
- `npm run test:domain`: reconfirmado 100% verde após as mudanças desta REF (nenhum arquivo de
  `src/`/`tests/` tocado).
- Sintaxe do workflow revalidada com `js-yaml` (mesmo mecanismo da CI-01) após cada edição — válida.

## Limitações conhecidas

- Sem threshold bloqueante — o job nunca falha por score baixo (decisão deliberada, ver §Decisão). Uma
  regressão real de performance não quebra o CI hoje, só fica visível no relatório.
- O workflow não foi disparado de verdade no GitHub Actions (exigiria push, fora do escopo desta
  sessão) — mesma limitação já registrada na REF-CI-01 para os outros jobs. Para este job em
  particular, isso importa um pouco mais: a verificação local do `autorun` completo esbarrou num bug
  de `chrome-launcher` específico do Windows (ver §Verificação local) — o motor em si está confirmado,
  mas o encadeamento completo (healthcheck → collect → upload) só é confirmado de fato no 1º run real
  em Linux.
- `test:db-guards` continua fora do CI automático (decisão de segurança da REF-CI-01, reafirmada
  aqui) — proposta de workflow `workflow_dispatch` manual permanece registrada, não implementada.

## Recomendações para futuras REFs

- REF-PERF-02: usar o relatório desta REF (não o de produção) como baseline para decidir thresholds
  reais de `assert`.
- Se quiser rodar os guards de produção sob demanda a partir do GitHub, criar o 2º workflow
  `workflow_dispatch` recomendado na REF-CI-01 — depende do dono cadastrar o secret de produção.
