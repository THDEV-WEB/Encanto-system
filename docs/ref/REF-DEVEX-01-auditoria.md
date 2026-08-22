# REF-DEVEX-01 — ESLint / Prettier / typecheck

Puxada do roadmap paralelo ([[encanto-roadmap-paralelo-saas01]]), 4a frente do Grupo 1 (depois de
REF-DASHBOARD-01, REF-OBS-02, REF-SEC-02). Autorizada pelo dono em 2026-08-22, junto com um
posicionamento explícito de negócio: o Encanto deixou de ser projeto de portfólio, o objetivo é
vendê-lo como SaaS real para empresas parceiras, em nível de competir com Anota-Aí, Pedidos10 e
Levalá Soluções — ou seja, decisões de qualidade técnica aqui têm peso comercial, não é luxo.

## Situação anterior

Achado confirmado na auditoria do roadmap (2026-08-08): o projeto nunca teve nenhuma ferramenta de
lint/format/typecheck configurada. 194 arquivos `.js`/`.jsx` em `src/` (~15.700 linhas), zero
`eslint.config.js`/`.eslintrc`, zero `.prettierrc`, zero `tsconfig.json`.

## O que foi instalado

`eslint@10.9.0` (flat config) + `@eslint/js` + `eslint-plugin-react-hooks@7.1.1` +
`eslint-plugin-react-refresh` + `globals`, `prettier@3.9.6` + `eslint-config-prettier` (desliga
regras estilísticas do ESLint que colidiriam com o Prettier), `typescript@7.0.2` +
`@types/react`/`@types/react-dom` (só para o `tsc` entender JSX — não é migração pra TS).
`npm audit` confirmou: nenhuma vulnerabilidade nova — os mesmos 9 avisos pré-existentes documentados
em [[encanto-ref-sec-02]] (esbuild/vite major bump, sharp/uuid/tar presos em `@capacitor/assets`).

## Decisão 1 — `eslint-plugin-react-hooks`: só as regras clássicas

O preset `recommended` da v7 do plugin inclui as regras do **React Compiler**
(`immutability`, `purity`, `set-state-in-render`, `set-state-in-effect`, etc.) — pensadas para quem
vai adotar o Compiler. Rodado cru, gerou **70 erros**, a maioria `react-hooks/set-state-in-effect`
marcando como erro o padrão idiomático `useEffect(() => { carregar(); }, [carregar])` (buscar dado
ao montar), usado dezenas de vezes no projeto. Este é React 18.2 sem Compiler — aplicar esse preset
inteiro exigiria reescrita em massa sem ganho real. `eslint.config.js` usa só
`rules-of-hooks` (error) + `exhaustive-deps` (warn), o par clássico que qualquer projeto Vite+React
18 usa por padrão.

## Decisão 2 — Prettier: configurado, mas NÃO aplicado ao código existente

`prettier --check .` aponta 434 arquivos fora do padrão (o projeto nunca foi formatado). Rodar
`--write` agora reformataria quase o repo inteiro num commit só — apaga o `git blame` de praticamente
toda linha existente e, com outros atores commitando em paralelo no mesmo repositório (confirmado
via `git status` no meio desta execução: arquivos não rastreados de REF-STORE-ONBOARD-01 e outra
frente em andamento), é risco real de conflito de merge contra trabalho já em curso. Perguntado ao
dono via pergunta direta: decisão foi **só configurar** (scripts `format`/`format:check` disponíveis)
e não reformatar o legado agora — Prettier passa a valer para código novo/tocado daqui pra frente.

## Decisão 3 — typecheck: `checkJs:false`, opt-in por arquivo

Projeto é 100% JS/JSX sem nenhuma anotação de tipo. Rodado com `checkJs:true` global, o `tsc` retornou
80+ erros bem antes de terminar de escanear — dominados por dois padrões estruturais, não bugs reais:
(1) inferência de "prop obrigatória" a partir do primeiro uso de cada componente (todo outro
call-site que passa menos props vira erro), e (2) objetos de `style` inline tipados como `string`
genérica em vez do literal esperado por `CSSProperties` (`position`, `textAlign`, `flexDirection`
etc.). Ligar `checkJs` globalmente num codebase legado sem anotação não é como se adota TS na
prática — o padrão oficial do TypeScript pra isso é `checkJs:false` + pragma `// @ts-check` por
arquivo. `tsconfig.json` ficou assim: `npm run typecheck` roda limpo (0 erros) hoje, e qualquer
arquivo novo (ou que alguém queira endurecer) liga o check sozinho. `src/vite-env.d.ts` referencia os
tipos de `vite/client` e `vite-plugin-pwa/client` e declara `__APP_RELEASE__` (constante de build via
`define` no `vite.config.js`) — infraestrutura pronta pra quando algum arquivo optar pelo check.

## Achados reais corrigidos (ESLint, com o ruleset final)

Baseline final: **0 erros, 49 avisos** (avisos = `no-unused-vars`/`exhaustive-deps` em código legado,
não bloqueiam). Dois erros de `rules-of-hooks` eram bugs de verdade, não falso-positivo:

- **`src/components/admin/ImageUploader.jsx:23`** —
  `const inputRef = useRef ? useRef(null) : React.useRef(null);`. `useRef` é importado diretamente,
  logo a condição é sempre truthy — o `React.useRef(null)` do outro ramo é morto, nunca executado.
  Ainda assim, sintaticamente é uma chamada de hook dentro de uma expressão condicional, violação real
  da regra. Corrigido para `const inputRef = useRef(null);` (import de `React` também removido — só
  era usado ali).
- **`src/components/checkout/SuccessPage.jsx`** — `const [statusIdx] = useState(0);` ficava DEPOIS de
  um `return` condicional (`if (!temWhatsapp) return (...)`). Nas renderizações em que
  `!temWhatsapp`, esse hook nunca era chamado; nas outras, era — violação real de ordem de hooks, que
  pode gerar o erro do React "Rendered fewer hooks than expected" se a prop `whatsapp` mudar de
  falsy pra truthy na MESMA instância montada do componente (sem remount). Corrigido movendo a
  declaração pra antes do `return` condicional, junto dos outros hooks do componente.

Validado que o fix não quebrou nada: `render.smoke.mjs` (parte de `npm run test:domain`) já renderiza
`SuccessPage` nos dois cenários (`SuccessPage(entrega, aberto)` e
`SuccessPage(sem whatsapp configurado)`) — ambos `ok` depois do fix, cobrindo exatamente os dois
ramos de hook que estavam em jogo.

Um erro de `no-useless-escape` (`scripts/auth-tenant-onda2-activate-tenant-test.mjs:223`, aspas
escapadas sem necessidade dentro de string com aspas simples) também corrigido — cosmético, zero
mudança de comportamento.

## CI

Novo job `lint` em `.github/workflows/ci.yml` (`REF-CI-01`), independente e paralelo aos 3 já
existentes (`build`/`domain-tests`/`e2e`): roda `npm run lint` (quebra em erro real, hoje zero) e
`npm run typecheck` (hoje não verifica nada por padrão, mas já protege qualquer arquivo que ligar
`// @ts-check` no futuro).

## Testes

`npm run build` (produção) ✅. `npm run test:domain` (suíte completa, ~26 scripts incluindo o render
smoke) ✅, exit code 0. `npm run lint` — 0 erros, 49 avisos. `npm run typecheck` — 0 erros.

## Why

Ligar as 3 ferramentas de uma vez sem gerar uma enxurrada de ruído que ninguém vai triar — cada
decisão acima (hooks clássico, Prettier não-retroativo, typecheck opt-in) existe porque a config
"padrão"/mais rigorosa gerava dezenas a centenas de avisos sem valor real num codebase legado nunca
lintado. Prioridade foi achado real > cobertura máxima no primeiro corte.

## How to apply

Regras de hooks do React Compiler (`react-hooks/immutability`, `purity`, etc.) só fazem sentido se o
projeto migrar pra React 19 + Compiler — decisão separada, não deste REF. Prettier retroativo em todo
o repo é uma decisão consciente e isolada (commit dedicado, coordenado com quem estiver com trabalho
em andamento) sempre que o dono quiser pagar esse custo de blame/conflito. Qualquer arquivo pode
ganhar typecheck real hoje mesmo — só adicionar `// @ts-check` no topo; o `tsconfig.json` já tem os
tipos de ambiente (`vite/client`, `vite-plugin-pwa/client`, `__APP_RELEASE__`) prontos.
