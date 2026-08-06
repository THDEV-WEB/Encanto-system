# REF-PERF-01 — Progresso de execução

Arquivo de retomada. Se a execução for interrompida, retomar a partir daqui. ADR completo (auditoria,
decisões técnicas, benchmark antes/depois): [REF-PERF-01-performance-inicializacao.md](../adr/REF-PERF-01-performance-inicializacao.md).

## Estado atual

✅ Ondas A–D **CONCLUÍDAS e commitadas localmente** (push não realizado — aguardando pedido). Onda E
(o maior ganho de toda a auditoria) tem o script pronto e o **dry-run já executado com sucesso** contra
produção; falta só o cutover real (`--apply`), que **depende de decisão do dono** — exige
`SUPABASE_SERVICE_ROLE_KEY`, ausente neste ambiente por desenho.

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

Status: 🟡 SCRIPT PRONTO + DRY-RUN EXECUTADO, cutover pendente. `scripts/reprocess-product-images.mjs`
— dry-run (client anônimo, só leitura) mediu **53,2MB → 2,9MB (−95%)** nas 38 imagens de produto do
catálogo real, 0 falhas. Commit `97ce3aa` (script + dry-run documentado).

**Próximo passo (decisão do dono):** rodar `node scripts/reprocess-product-images.mjs --apply` com
`SUPABASE_SERVICE_ROLE_KEY` em `.env.local` (gitignored) — ou fornecer a chave para rodar por aqui. O
script nunca apaga/sobrescreve o original (sobe arquivo novo + `UPDATE imagem_url`) e grava um log JSON
de reversão antes de cada escrita. Recomendação: rodar primeiro com `--apply --limit 2` (teste
controlado em 2 produtos) antes do catálogo inteiro.

## Benchmark

Lighthouse mobile antes/depois das Ondas A–C — ver ADR §5. Performance 37→41/100; LCP 5,9s→4,4s (−25%);
TTI 8,1s→7,1s. TBT/Speed Index/payload continuam dominados pelas imagens de produto ainda não
reprocessadas — maior salto projetado só depois do cutover da Onda E.

## Testes

`test:render` (16/16) · `test:deps` (isolamento dos domínios) · `test:domain` (37/37) · `build` (3x,
sem warning de chunk >500KB depois da Onda C) — todos verdes. Detalhe completo no ADR §6.
