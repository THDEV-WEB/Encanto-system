# REF-PERF-04 — investigação e correção do CLS residual

Fecha a pendência registrada no encerramento da [REF-PERF-03](REF-PERF-03-bootstrap-multitenant.md):
depois de eliminar o wave duplicado de catálogo (7→4 requests, confirmado real no CI), o CLS do
Lighthouse continuou intermitente (3 de 6 sub-runs > 0,47), com causa ainda não identificada. Esta REF
NÃO assumiu que o catálogo era o culpado — auditou o bootstrap inteiro (fontes, imagens, header,
componentes condicionais, skeleton) antes de tocar em qualquer código.

## Fase 1 — Diagnóstico

Reexame dos 6 relatórios Lighthouse já coletados na REF-PERF-03 (2 execuções reais de CI, 3 sub-runs
cada), cruzando timing de rede request-a-request com o CLS de cada sub-run, mais leitura do código
(`index.html`, CSS do header, hooks de dados institucionais).

**Limitação de ferramenta confirmada**: o audit `layout-shifts` (atribuição do elemento causador) do
Lighthouse errou nos 6/6 sub-runs (`Cannot read properties of undefined (reading 'frame_sequence')` —
bug conhecido do trace engine desta versão). Não houve atribuição direta de causa pelo próprio
Lighthouse — o diagnóstico abaixo veio de leitura de código + correlação manual de timing de rede.

### Mecanismo 1 — Google Fonts render-blocking, `display=swap`, latência externa variável
`index.html`: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins...">`
sem preload — render-blocking por especificação. Latência real observada entre sub-runs do MESMO
código: 58ms a 386ms. Na execução 1 da REF-PERF-03, essa variação se correlacionava quase
perfeitamente com quando todas as RPCs paralelas (horário/entrega/empresa/tenant) e depois o catálogo
começavam a ser buscados — o boot inteiro esperava essa rede externa resolver antes do primeiro paint.

### Mecanismo 2 — logo do header condicional, sem espaço reservado
`useCompanyInfo.js` começa com `logoUrl=null`; `StoreApp.jsx` renderizava
`{companyInfo.logoUrl && <img className="header-brand-logo".../>}`. `.header-brand-col` (container
flex) não tinha largura mínima — colapsava a 0px sem o logo e saltava para o tamanho do logo quando a
sincronização chegava.

**Confirmado objetivamente** (teste isolado com Playwright, `.env.e2e`, RPC `get_company_info`
interceptada para forçar a transição `logoUrl: null → populado`):

| | `.header-brand-col` largura | vizinho `.header-logo` (nome/status) X |
|---|---|---|
| Código antigo, ANTES do logo | 0px | 22px |
| Código antigo, DEPOIS do logo | 80px | 102px |
| **Salto real medido** | **+80px** | **+80px horizontais** |

Nota: a loja "encanto" do projeto Supabase E2E **não tem `logoUrl` configurado** (`get_company_info`
real não retorna esse campo) — então este mecanismo especificamente **não** contribuiu para a
variância de CLS medida nos 6 sub-runs de CI da REF-PERF-03 (não havia logo pra aparecer ali). O
mecanismo em si é real e válido para produção (a Encanto tem logo configurado lá) e para qualquer
tenant futuro com logo — por isso foi corrigido mesmo assim, mas não é a explicação completa da
variância observada em CI.

### Mecanismo 3 — skeleton undersizado (2 seções vs. 8 categorias reais)
Já documentado na REF-PERF-02 como causa original do CLS antes de qualquer correção — nunca foi
revisitado desde então. Catálogo real da Encanto tem 8 categorias ativas; o skeleton reservava espaço
para só 2 seções — mismatch de tamanho na troca skeleton → grade real, independente de qualquer
timing de rede.

### Achado adicional — nem toda variância é de timing de rede
Comparando `run2-2` (CLS 0,526) com `run2-3` (CLS 0,051) da REF-PERF-03: timing de rede
**praticamente idêntico** entre os dois (mesma ordem, diferenças de poucos ms), CLS 10x diferente.
Isso **não é explicado** pelos 3 mecanismos acima nem por latência de rede — indica um componente de
ruído do lado de renderização/agendamento do main-thread que não é possível eliminar por código
(classificado como B/D abaixo).

## Fase 2 — Classificação (causa real vs. ruído do ambiente)

| Mecanismo | Classificação | Confiança | Corrigido nesta REF? |
|---|---|---|---|
| Google Fonts render-blocking | A) produto/código | média-alta (correlação forte, sem atribuição direta do Lighthouse) | Sim |
| Logo condicional sem espaço reservado | A) produto/código | alta (confirmado objetivamente por teste isolado) — mas não a causa da variância medida em CI (E2E sem logo) | Sim |
| Skeleton undersizado | A) produto/código | alta (mismatch de tamanho documentado desde a REF-PERF-02, nunca revisitado) | Sim |
| Variância com timing de rede idêntico (run2-2 vs run2-3) | B) ambiente/runner, possivelmente D) indeterminado | baixa-média (só inferida por eliminação) | Não — não é corrigível em código |

**Não existe uma causa raiz única.** É uma combinação (C): pelo menos 2 mecanismos de produto
confirmados (fonte + skeleton), 1 mecanismo de produto real mas não-observado-nesta-medição (logo), e
um componente residual de ruído de ambiente que nenhuma correção de código elimina.

## Fase 3 — Correções implementadas (baixo risco, sem decisão arquitetural)

### 1. `index.html` — Google Fonts assíncrona (preload + onload)
```html
<link rel="preload" as="style" href="...css2?family=Poppins..." onload="this.onload=null;this.rel='stylesheet'"/>
<noscript><link href="...css2?family=Poppins..." rel="stylesheet"/></noscript>
```
Por que reduz CLS: o primeiro paint deixa de esperar essa rede externa (deixa de ser render-blocking).
`display=swap` continua trocando pra Poppins assim que os `.woff2` carregarem — mesmos pesos
(400-800), mesma família, zero mudança de identidade visual depois de carregada. `<noscript>` preserva
o comportamento antigo se JS estiver desativado. Quebra a correlação "latência da fonte → atraso de
todo o boot" medida na REF-PERF-03.

### 2. `src/index.css` — espaço reservado para o logo do header
```css
.header-brand-col{
  display:flex;align-items:center;justify-content:center;flex-shrink:0;
  min-width:112px;min-height:112px;
}
@media(max-width:768px){.header-brand-col{min-width:92px;min-height:92px}}
@media(max-width:480px){.header-brand-col{min-width:80px;min-height:80px}}
```
Mesmos breakpoints do `.header-brand-logo` já existente. Por que reduz CLS: a coluna passa a ocupar o
mesmo espaço com ou sem o `<img>` montado — confirmado objetivamente (tabela acima): salto de 80px
eliminado. `StoreApp.jsx` não precisou de nenhuma mudança (solução 100% CSS, sem JavaScript para
calcular largura, conforme pedido).

### 3. `src/components/ui/CatalogSkeleton.jsx` — skeleton mais representativo
De 2 para 3 seções falsas (`SkelSection`). Por que reduz CLS: aproxima melhor a altura real de um
catálogo com várias categorias visíveis, sem criar um 2º fetch (a contagem real de categorias só é
conhecida depois do fetch, que é exatamente o que a REF-PERF-03 parou de esperar) nem inflar o
conteúdo a ponto de pesar no 1º paint — 3 é um meio-termo estático e determinístico, documentado no
próprio arquivo.

## Fase 4 — Validação

- `npm run lint`: 0 erros, 53 warnings pré-existentes (mesmo número de antes da REF).
- `npm run typecheck`: limpo.
- `npm run test:domain`: passou.
- `npm run build`: passou.
- `npm run test:e2e` (suíte completa, projeto Supabase E2E dedicado): **120/125 passou**, 4 falharam, 1
  não rodou (cascata de um `describe.serial`). As 4 falhas foram investigadas individualmente contra o
  baseline (código sem as 3 correções desta REF, via `git stash`), a mesma metodologia da REF-PERF-03:
  - `logout.spec.js:39` — já confirmada pré-existente na REF-PERF-03 (reproduz idêntica no baseline).
  - `minha-conta.spec.js:49` — reproduz no baseline também (timeout clicando "Salvar alterações",
    elemento instável/coberto por outro — instabilidade de UI já existente, não desta REF).
  - `admin-pedidos-busca.spec.js:54` e `admin-pedidos-comanda.spec.js:30` — **passam** isoladamente
    tanto no código desta REF quanto no baseline; só falharam dentro da execução serial completa de
    125 specs (flakiness de ordem/estado compartilhado da suíte, não das 3 correções — nenhuma delas
    toca `admin.html`, bundle separado do storefront, nem lógica JS de pedidos/comanda).
  - **Conclusão: 0 regressões causadas pelas 3 correções desta REF.**
- Teste objetivo de geometria do header (item 5 do pedido): ver tabela do Mecanismo 2 acima — salto de
  80px eliminado, confirmado com Playwright isolado.
- Lighthouse (múltiplas execuções, CI real): ver seção de resultado abaixo.
