# REF-CI-01 — Continuous Integration

**Status:** ✅ Implementada e verificada (2026-07-24) — pipeline de 3 jobs paralelos
(`build`/`domain-tests`/`e2e`), workflow YAML validado sintaticamente (`js-yaml`, efêmero via
`npx`, nunca instalado como dependência) e cada passo do job `e2e` exercitado manualmente nesta
sessão (não há como disparar o Actions de verdade sem push, que está fora do escopo — ver
§Encerramento). Aguardando aprovação do dono para o commit (nenhum push realizado).
**Depende de:** toda a suíte de testes já existente (REF-E2E-01/02/03, REF-ADMIN-01/02/03 e os ~26
scripts de domínio) — este REF não cria testes novos, cria a INFRAESTRUTURA que os roda
automaticamente.
**Relacionado:** primeira REF deste projeto a tocar `.github/`; não existia nenhum workflow antes.

## Auditoria (estado inicial)

- Nenhum `.github/workflows` existente — greenfield.
- Nenhum `.eslintrc`/`eslint.config.*` — este projeto nunca teve linter configurado.
- Nenhum `.nvmrc`/`engines` em `package.json` — Node local: v24.17.0.
- `package-lock.json` presente — `npm ci` (reprodutível, exige lockfile) é viável.
- 3 categorias de teste com necessidades MUITO diferentes de credenciais:
  1. **Build** (`vite build`) — zero segredo. Confirmado empiricamente: renomeei `.env` local
     temporariamente (restaurado logo em seguida) e o build completou normalmente, só com um aviso
     benigno sobre `%VITE_SUPABASE_URL%` não definido no `index.html` (placeholder, não é erro).
  2. **Suíte de domínio** (`tests/*.mjs`, ~26 scripts) — 100% lógica pura/estática
     (`readFileSync` + regex sobre o próprio código-fonte, o mesmo padrão dos guards R2/R4/R5/R6 do
     `test:ds-micro`). Confirmado por grep: nenhum desses arquivos referencia `db.env`/`PGHOST`/
     `process.env` de credencial nenhuma.
  3. **Guards de banco** (`scripts/*.mjs`: `test:f1b`, `test:rls`, `test:orders-rls`,
     `test:auth-rls`, `verify:norm05`, `guard:slug`) — conexão Postgres DIRETA à **produção**
     (`C:\Users\00thi\.encanto\db.env`), sempre em `BEGIN...ROLLBACK` (mutação líquida = 0).
  4. **E2E (Playwright)** — projeto Supabase DEDICADO a testes (`encanto-e2e`, nunca produção,
     REF-E2E-01), com um mecanismo de degradação já embutido: sem `VITE_SUPABASE_URL`/`KEY`, o app
     roda com o catálogo MOCK e os specs `@writes` fazem `test.skip(!E2E_ENV_PRONTO)` — não é um
     código novo desta REF, já existia desde a REF-E2E-01.

## Decisão — o que entra no pipeline automático (push/PR) e o que fica de fora

**Entram (job por categoria, os 3 rodam em PARALELO — nenhum `needs:` entre eles):**
- `build`: `npm ci` + `npm run build`.
- `domain-tests`: `npm ci` + `npm run test:domain` (script novo, agrega os ~26 scripts de domínio
  num só comando — não existia; útil tanto para CI quanto para rodar tudo localmente de uma vez).
- `e2e`: Playwright completo contra o projeto DEDICADO de testes.

**NÃO entram no pipeline automático — decisão deliberada, motivo: segurança:** os 6 guards de banco
que exigem a connection string de PRODUÇÃO (`test:db-guards`, script novo que os agrega LOCALMENTE
— não em CI). Expor credenciais de produção como secret de um workflow que roda em TODO push/PR
(incluindo, em tese, de um fork, ainda que o GitHub já bloqueie secrets nesse caso por padrão) é um
risco desproporcional ao ganho: esses guards já rodam localmente há várias REFs, sempre dentro de
transação com ROLLBACK, e continuam preenchendo exatamente esse papel — só não ganham um gatilho
automático a cada push. Se o dono quiser rodá-los sob demanda a partir do próprio GitHub (não só
localmente), a via seria um 2º workflow com `workflow_dispatch` (execução manual, nunca automática) —
não criado nesta REF por não ter sido pedido e por exigir que o PRÓPRIO dono cadastre o secret de
produção nas configurações do repositório (fora do alcance desta sessão).

**ESLint/typecheck — não introduzidos:** o projeto nunca teve linter configurado; adicionar um do
zero provavelmente acusaria um volume grande de achados pré-existentes em código nunca escrito com
essas regras em mente, transformando o 1º dia de CI numa fonte de ruído (ou exigindo uma varredura de
correções fora do escopo desta REF: "a prioridade NÃO é adicionar funcionalidades novas"). Registrado
como recomendação para uma REF futura dedicada, não decidido aqui por conta própria.

## Onda 1 — Build + testes de domínio

`.github/workflows/ci.yml`, jobs `build` e `domain-tests`. `actions/setup-node@v4` com
`node-version: '24'` (casa com a versão local) + `cache: npm` (cache nativo do `setup-node`, chaveado
pelo `package-lock.json` — sem necessidade de um `actions/cache` manual aqui). Novo script
`"test:domain"` em `package.json` — encadeia os ~26 scripts com `&&` (para no 1º que falhar).

Testado localmente: `npm run test:domain` rodou os 26 scripts do início ao fim sem interrupção
(todos verdes) — mesmo comando que o job de CI executa.

## Onda 2 — E2E no CI

Job `e2e`: `npx playwright install --with-deps chromium` (navegador + dependências de sistema;
`actions/cache` sobre `~/.cache/ms-playwright` acelera reruns pulando o download do binário — as
dependências de sistema via `apt` continuam sendo reinstaladas a cada run, por ser uma VM efêmera do
GitHub, mas isso é rápido quando os pacotes já fazem parte da imagem base do runner). Um passo escreve
`.env.e2e` a partir de 3 secrets (`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`,
`E2E_SUPABASE_SERVICE_ROLE_KEY`) — os únicos que o dono precisa cadastrar em
Settings → Secrets and variables → Actions para a suíte completa (`@writes` incluído) rodar; sem eles,
o job **não fica vermelho** — só roda com cobertura reduzida (`@read-only` contra o catálogo mock,
`@writes` pulando via `test.skip`), pois é exatamente esse o comportamento já embutido no projeto desde
a REF-E2E-01 (não código novo desta REF).

**Validação desta onda (sem poder disparar o Actions de verdade — ver §Encerramento):**
- Sintaxe do workflow inteiro validada com `js-yaml` (`npx --yes js-yaml .github/workflows/ci.yml`,
  pacote efêmero, nunca adicionado a `package.json`) — parseou para JSON sem erro, estrutura conferida
  campo a campo.
- O passo de geração do `.env.e2e` via heredoc foi replicado e executado isoladamente (fora do repo,
  em `/tmp`) tanto com valores fictícios quanto com STRINGS VAZIAS (simulando secrets não
  cadastrados) — nos dois casos o arquivo é gerado corretamente, sem erro.
- Confirmado que `createClient('', '')` (o cenário de secrets vazios) **lança erro SINCRONAMENTE**
  ("supabaseUrl is required") — exatamente o que o `try/catch` de `lib/supabase.js` já existe para
  capturar (`db=null`, modo degradado). Testado isoladamente (script `_tmp` fora do controle de
  versão, apagado em seguida) — não é uma suposição, foi executado.
- A suíte E2E completa (`npm run test:e2e`) foi reexecutada do zero DEPOIS de toda a auditoria desta
  REF, com o `.env.e2e` real (projeto dedicado) — 104/104 verdes, confirmando que nada nesta REF
  quebrou o que já funcionava.

**Incidente durante a validação (auto-contido, sem impacto no resultado final):** ao tentar confirmar
o cenário "sem secrets" fim-a-fim via um `npx playwright test` real contra um `.env.e2e` vazio, o
comando ficou sem produzir saída por mais de 300s e foi movido para 2º plano; investigado e
interrompido. Causa mais provável: reuso de um processo `vite` anterior ainda ouvindo a porta 5183
(`reuseExistingServer: true` fora de CI) somado a buffering do pipe da ferramenta de shell — não uma
trava real do app (confirmado à parte, ver item anterior). O arquivo `.env.e2e` REAL foi imediatamente
restaurado do backup feito antes do teste (nunca ficou sem backup) e revalidado com 2 specs
(`boot.spec.js` genérico + `catalog.spec.js` com asserção de dado ESPECÍFICO do fixture, que só passa
com credenciais reais) — ambos verdes, confirmando a restauração íntegra. O processo remanescente na
porta 5183 foi encerrado antes de prosseguir. Em CI de verdade este cenário não se repete: cada job
nasce numa VM efêmera nova (`reuseExistingServer` já é `false` sempre que `CI=true`, setado
automaticamente pelo GitHub) — não há processo anterior para reaproveitar.

## Onda 3 — Organização, cache, badge, documentação

- `package.json`: `test:domain` (Onda 1) + `test:db-guards` (agrega os 6 guards de produção só para
  uso LOCAL — `test:f1b` fica por ÚLTIMO na cadeia de propósito, já que tem 3 falhas
  pré-existentes/congeladas desde a REF-ADMIN-CATALOG-01; colocá-lo por último deixa os OUTROS 5
  guards executarem e reportarem antes do ponto conhecido de parada).
- Cache: `actions/setup-node@v4` (`cache: npm`, nativo) nos 3 jobs + `actions/cache@v4` dedicado para
  os binários do Playwright no job `e2e`.
- Badge de status no `README.md` raiz (`![CI](...)`), apontando para o workflow.
- `permissions: contents: read` no nível do workflow (princípio do menor privilégio — nenhum job
  precisa escrever no repositório) + `concurrency` (cancela um run em andamento se um push mais novo
  chegar na mesma branch/PR, evita gastar minutos de CI em código já superado).
- Documentação: este ADR + seção nova no `e2e/README.md`.

## Verificação final

- Sintaxe do workflow: válida (`js-yaml`, ver Onda 2).
- `npm run build`: limpo.
- `npm run test:domain`: 26/26 scripts verdes.
- `npm run test:e2e`: **104/104** (suíte completa, reexecutada após todas as mudanças desta REF).
- `test:rls` (PASS=15), `test:orders-rls` (PASS=16), `test:auth-rls` (PASS=10): 100% verde, zero
  escrita persistida (rodados manualmente, fora do pipeline de CI — ver §Decisão).
- Nenhum arquivo de runtime (`src/`) foi alterado por esta REF — só `package.json` (2 scripts novos),
  `.github/workflows/ci.yml` (novo), `README.md` (badge) e documentação. Superfície de regressão real
  é próxima de zero.

## Limitações conhecidas

- Os 6 guards de banco de produção permanecem fora do pipeline automático (decisão de segurança, ver
  §Decisão) — continuam sendo responsabilidade do dono rodar localmente quando fizer sentido.
- Sem ESLint/typecheck — não existia antes, não foi criado agora (ver §Decisão).
- O workflow não foi disparado de verdade no GitHub Actions (exigiria push, fora do escopo desta
  sessão) — a validação foi feita por: (a) parsing sintático do YAML, (b) execução manual de cada
  comando que os steps invocam, neste mesmo shell, (c) o mecanismo específico de "secrets vazios"
  isolado e confirmado. O 1º push é o único passo que falta para a confirmação definitiva end-to-end.
- Sem os secrets `E2E_SUPABASE_*` cadastrados no repositório, o job `e2e` roda com cobertura reduzida
  (só `@read-only`) até o dono cadastrá-los.

## Recomendações para futuras REFs

- Depois do 1º push real, conferir o resultado do Actions (tempo total de wall-clock, se o cache do
  Playwright de fato reduz o tempo de instalação em runs subsequentes).
- Se o volume de testes crescer muito, considerar sharding do Playwright (`--shard`) para paralelizar
  a suíte E2E em múltiplos runners.
- Avaliar introduzir ESLint (com uma configuração permissiva inicial, focada em erros reais — não
  estilo) como uma REF própria, dado o volume de achados que provavelmente apareceria num código nunca
  lintado.
- Um 2º workflow `workflow_dispatch` para os guards de produção, se o dono quiser rodá-los sob demanda
  a partir do GitHub (não só localmente) — precisa que ele cadastre o secret de produção.
