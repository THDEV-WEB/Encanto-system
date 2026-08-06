# REF-PERF-01 — Progresso de execução

Arquivo de retomada. ADR completo (auditoria, decisões técnicas, benchmark antes/depois):
[REF-PERF-01-performance-inicializacao.md](../adr/REF-PERF-01-performance-inicializacao.md).

## Estado atual

✅ **CONCLUÍDA — Ondas A-E implementadas e validadas.** Cutover de produção da Onda E executado em 2
fases controladas (piloto de 2 produtos + validação, depois o restante), sem nenhuma falha ou regressão.
Performance Lighthouse mobile: **37→68/100**; payload da loja: **23,6MB→1,6MB (−93%)**. Commits locais
(8), push condicionado à aprovação do dono após validação completa — **autorizado, aguardando execução**.

## Onda A — Compressão client-side no upload

Status: ✅ CONCLUÍDA. `src/utils/imageCompression.js` (novo) + `ImageUploader.jsx`. Commit `f2659a6`.

## Onda B — Assets estáticos do boot + preload do banner

Status: ✅ CONCLUÍDA. `scripts/optimize-static-images.mjs` (sharp) gerou os 3 `.webp`; `index.html`
ganhou preload+fetchpriority do banner. −78% no peso dos assets fixos (441,4KB→97,7KB). Commit `670679f`.

## Onda C — Code splitting (Checkout/ProductModal/StoreMenu/CartSidebar)

Status: ✅ CONCLUÍDA. `StoreApp.jsx` + `StoreMenu.jsx` — `React.lazy`+`Suspense`. Chunk principal
537,75KB→474,30KB (154,93KB→137,76KB gzip). Validado com smoke Playwright (chunks lazy sem erro).
Commit `f8c41c6`.

## Onda D — Dynamic import dos plugins Capacitor

Status: ✅ AVALIADA, **não implementada** (decisão registrada no ADR §3) — ganho pequeno (~6-7KB gzip)
vs. risco de tocar `AuthService.js`/`useCapacitorBackButton.js`, área encerrada pela REF-CAP-01
("ENCERRADA, não revisitar"). Sem commit (nenhuma mudança de código).

## Onda E — Reprocessamento das imagens de produto já publicadas

Status: ✅ **CONCLUÍDA — cutover de produção executado e validado.**

- Script (dry-run/apply/rollback) — commits `97ce3aa` (dry-run) + `47f3503` (rollback automatizado,
  pedido antes da execução em massa).
- **Piloto** (`--apply --limit 2`): 2 produtos, 3.142,4KB→151,5KB (−95%), 0 falhas. Validado por fetch
  direto das URLs (200/webp/tamanho correto), inspeção visual (nítido, sem distorção) e Playwright na
  loja real (card, modal do produto, carrinho) — zero erro de console/rede. Um dos 2 produtos do piloto
  está `disponivel:false` no banco (pré-existente, não relacionado a esta REF) — validado só pela
  imagem/URL direta, já que não aparece na vitrine.
- **Restante do catálogo** (`--apply`, 36 produtos): 51.358,9KB→2.829,5KB (−94%), 0 falhas.
- **Validação ampla pós-cutover**: Playwright rolando a loja inteira — 28 cards no DOM, 0 imagem
  quebrada, 0 erro de rede/console.
- Logs de reversão de cada fase commitados no repositório (rastreabilidade + `--rollback` disponível a
  qualquer momento).
- Total combinado: 38 produtos, **54.501,3KB → 2.981,0KB (−95%)** — bate com o dry-run original.

## Benchmark final

| Métrica | Antes | Depois (A-C) | Depois (+ Onda E) |
|---|---|---|---|
| Performance score | 37/100 | 41/100 | **68/100** |
| LCP | 5,9s | 4,4s | 4,3s |
| TBT | 910ms | 970ms | **160ms** |
| Speed Index | 4,9s | 5,9s | **3,1s** |
| Payload total | 23,6 MB | 23,2 MB | **1,6 MB** |

Detalhe completo no ADR §5.

## Testes

`test:render` (16/16) · `test:deps` (isolamento dos domínios) · `test:domain` (37/37) · `build` (verde,
sem warning de chunk >500KB) · validação visual manual (screenshots + inspeção de imagem) · Playwright
(smoke de chunks lazy + QA do piloto + validação ampla pós-cutover, todos zero erro) — ver ADR §6.

## Próximo passo

Push dos 8 commits locais — autorizado pelo dono, condicionado à validação completa (cumprida nesta
sessão). Limpeza dos arquivos originais órfãos no Storage fica fora de escopo desta REF (não há pressa
operacional; eles não pesam no boot da loja).
