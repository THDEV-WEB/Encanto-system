# ADR REF-PERF-01 — Performance de inicialização (startup performance)

**Status:** ✅ CONCLUÍDA — Ondas A-E implementadas, cutover de produção da Onda E executado e validado
(2 fases controladas: piloto de 2 produtos + validação, depois o restante do catálogo). Performance
Lighthouse mobile final: **37→68/100**, payload **23,6MB→1,6MB (−93%)**.
**Depende de:** nenhuma REF anterior especificamente — toca a loja inteira (boot, catálogo, checkout,
menu) e o pipeline de upload de imagem do Admin (`ImageUploader.jsx`, REF-APP-01 · Onda 6.3).
**Push/deploy:** commits locais; push condicionado à aprovação explícita do dono após a validação
completa (autorizada — ver §5).

## 1. Contexto

Auditoria de startup performance pedida diretamente pelo dono, com objetivo explícito: abertura da loja
"com sensação de aplicativo nativo", baseada em medição real (build de produção + Lighthouse mobile +
treemap do bundle + tráfego de rede real contra o Supabase de produção), não em achismo.

## 2. Auditoria — metodologia e achados

Build de produção (`vite build`) servido via `vite preview`, Lighthouse mobile (`--form-factor=mobile
--throttling-method=simulate`) rodado contra ele com Microsoft Edge headless, treemap do bundle via
`vite-bundle-visualizer` (extração manual do `nodeMetas`/`nodeParts` do relatório pra somar por
pacote/pasta), e leitura direta do código para as chamadas ao Supabase no boot.

**Baseline (antes):** Performance **37/100** · FCP 2,1s · **LCP 5,9s** · TBT 910ms · CLS 0,3 · TTI 8,1s ·
payload total **23,6 MB**.

### 2.1 Imagens de produto sem resize/compressão no upload — gargalo dominante

`ImageUploader.jsx` (Admin) aceitava arquivo até 5MB e subia **sem nenhum resize/recompressão** pro
Supabase Storage. Medido ao vivo contra produção: 38 produtos, imagens de até 2,1MB cada, somando
**53,2 MB** só de catálogo. Isso sozinho explica a maior parte do LCP/TBT/payload — confirmado via
`network-requests` do Lighthouse (12 imagens de produto entre 1,7MB e 2,1MB aparecem entre as 15 maiores
requisições da página, à frente até do próprio bundle JS).

### 2.2 Banner do header sem preload/formato adequado

`header-bg.jpg`: 353KB, 1536×1024px físico, para uma faixa exibida de 96-128px de altura. Aplicado via
CSS custom property setada em `style` inline (`StoreApp.jsx`) — o navegador só descobre essa URL depois
do JS montar (invisível ao parser de HTML), atrasando a descoberta do maior candidato a LCP da loja.

### 2.3 Bundle JS: 1 chunk único, zero code splitting

537,75KB minificado / 154,93KB gzip num chunk só — o próprio Vite alertava no build
(`chunkSizeWarningLimit`). Treemap mostrou `CheckoutPage`, `SuccessPage`, `ProductModalInner` e as 8
telas do menu (`LoginScreen`/`MinhaContaScreen`/`MeusPedidosScreen`/`SideDrawer`/...) todas carregadas no
boot, mesmo não sendo necessárias pra 1ª renderização — só entram por interação. Lighthouse estimava
~92KB de JS não usado no load inicial.

### 2.4 `@capacitor/core|browser|app` no bundle Web

~26KB (fonte) importados estaticamente em `AuthService.js`/`useCapacitorBackButton.js`/
`nativePrint.js`/`printComanda.js`, mesmo quando o app não roda dentro do APK.

### 2.5 Logo/selo institucional em resolução acima do exibido

`logo.jpg` (1080×1080, 45,9KB) exibido a no máximo 147×207px; `valion-mark.png` (42,8KB) exibido a
~34px de altura — ambos carregam em **toda** visita à loja (header + rodapé).

### 2.6 O que a auditoria NÃO encontrou de errado

Os hooks de dados (`useCategories`/`useProducts`/`useBusinessHours`/`useLoyalty`/`useCompanyInfo`/
`useDeliveryEta`) já pintam primeiro pelo cache local (síncrono, sem flash) e disparam a sincronização
oficial com o Supabase **em paralelo** — cada um no seu próprio `useEffect`, sem waterfall entre eles.
Não havia nada pra corrigir nessa camada; o design já era correto antes desta REF.

## 3. Decisão / ondas implementadas

### Onda A — compressão client-side no upload (código, sem migration)

`src/utils/imageCompression.js`: redimensiona via Canvas (`createImageBitmap` + `canvas.toBlob`) para o
maior lado ≤1280px (headroom pro maior uso real: modal 480px × ~3x DPI) e reencoda JPEG qualidade 0,82
antes do upload em `ImageUploader.jsx`. GIF fica de fora (perderia animação ao redesenhar em canvas).
Nunca piora um arquivo já pequeno (compara tamanho antes/depois, usa o menor). Cobre só uploads
**futuros** — não toca nas imagens já publicadas (Onda E).

### Onda B — assets estáticos do boot + preload do banner (código + assets, sem migration)

`scripts/optimize-static-images.mjs` (sharp, devDependency nova) gerou `.webp` ao lado de cada original
(nunca apaga/sobrescreve):

| Arquivo | Antes | Depois | Redução |
|---|---|---|---|
| `header-bg.jpg` → `header-bg.webp` | 352,7 KB | 79,0 KB | −78% |
| `logo.jpg` → `logo.webp` | 45,9 KB | 11,3 KB | −75% |
| `valion-mark.png` → `valion-mark.webp` | 42,8 KB | 7,4 KB | −83% |

Total: 441,4KB → 97,7KB por visita (−78%), mesma imagem/qualidade visual — só resolução/formato
adequados ao tamanho realmente exibido. `index.html` ganhou `<link rel="preload" as="image"
fetchpriority="high">` do banner (sem isso o navegador só descobria a URL depois do JS montar) e perdeu
o `preconnect` morto a `images.unsplash.com` (usado só pelo fallback MOCK offline; no caminho normal
nunca era exercitado).

### Onda C — code splitting fora do caminho crítico (código, sem migration)

`StoreApp.jsx`: `ProductModal`/`CartSidebar`/`CheckoutPage`/`SuccessPage` viraram `React.lazy()` +
`Suspense` (fallback `Spinner` nas páginas cheias, `null` nos overlays). `StoreMenu.jsx`: as 8 telas do
drawer viraram `React.lazy()`; `CompletarCadastro` fica eager (sempre ativo, auto-oculta, não está atrás
de nenhum clique). Resultado medido: chunk principal 537,75KB→474,30KB (−63KB) / 154,93KB→137,76KB gzip
(−17KB); o resto virou 8 chunks sob demanda (o maior, `CheckoutPage`, 21,2KB/7,49KB gzip). Validado com
smoke interativo via Playwright headless (abrir produto/carrinho/menu) — chunks lazy carregam sem erro
de console/rede.

### Onda D — plugins Capacitor no bundle Web: avaliada, **não implementada**

Considerado dynamic `import()` de `@capacitor/*` gated por `Capacitor.isNativePlatform()`. Descartado:
o ganho real é pequeno (~6-7KB gzip, medido no treemap) e o código que precisaria mudar é
`AuthService.js` (fluxo de login) e `useCapacitorBackButton.js` (botão físico voltar) — área sensível,
tocada pela REF-CAP-01 (**"ENCERRADA, não revisitar"**, ver memória do projeto). Risco/retorno
desfavorável comparado às ondas A-C; registrado como achado, sem ação.

### Onda E — reprocessamento das imagens de produto já publicadas (CONCLUÍDA, cutover aplicado)

O maior gargalo medido (§2.1) só se resolve reprocessando o que **já está** no Storage — Onda A cobre
só uploads futuros. `scripts/reprocess-product-images.mjs`:

- **Modo padrão = dry-run**: lê `products` com o client **anônimo** (mesma permissão que a própria loja
  usa pra listar o catálogo), baixa cada imagem pela URL pública, mede antes/depois com `sharp`
  (mesmo alvo da Onda A: 1280px, aqui reencodado WebP qualidade 80). Nada é gravado.
- **Modo `--apply`**: sobe a versão reprocessada como **arquivo novo** no bucket (nunca apaga/sobrescreve
  o original) e só então faz `UPDATE products.imagem_url`. Exige `SUPABASE_SERVICE_ROLE_KEY` em
  `.env.local` (gitignored) porque `products.UPDATE` é restrito a `is_admin()` via RLS
  (`AUTH-01-step2-harden-rls.sql`) — a anon key nunca teria permissão. O dono forneceu a chave (adicionada
  por mim direto em `.env.local`, nunca commitada) depois de aprovar o plano de execução controlada.
- **Modo `--rollback <log.json>`** (adicionado antes da execução em massa, a pedido do dono): lê o log de
  reversão de um `--apply` anterior e devolve `imagem_url` pra `url_antiga`, um a um — só se o valor
  atual ainda for exatamente o que aquele apply escreveu (guarda contra apagar uma edição mais recente
  feita por outro canal). Nunca apaga o `.webp` reprocessado do Storage.
- Filtro anti-reprocessamento (`/reprocessed_` na URL): uma 2ª rodada do script nunca reprocessa um item
  já tratado numa rodada anterior — necessário porque a execução real virou 2 fases (piloto + resto).

**Execução real (produção), em 2 fases controladas, por pedido do dono:**

1. **Piloto — `--apply --limit 2`:** 2 produtos, 3.142,4KB→151,5KB (−95%), 0 falhas. Validação: fetch
   direto das novas URLs (200, `image/webp`, tamanho correto) + inspeção visual (nítidas, sem distorção,
   sem artefato) + Playwright headless na loja real — screenshot do card no catálogo, do modal do produto
   (imagem inteira, sem corte indevido) e do carrinho (miniatura correta), zero erro de console/rede. O
   2º produto do piloto (`Água de Coco`) está com `disponivel:false` no banco (estado pré-existente,
   não relacionado a esta REF) — não aparece na vitrine por desenho; validado só pela URL/imagem direta e
   pelo código do Admin (`AdminProducts.jsx:268-269` usa o mesmíssimo padrão `<img src={imagem_url}>` da
   loja, sem validação extra de formato/dimensão — não foi possível logar no Admin nesta sessão por falta
   de credencial, mas o mecanismo de renderização é idêntico ao já validado).
2. **Restante do catálogo — `--apply` (36 produtos):** 51.358,9KB→2.829,5KB (−94%), 0 falhas.
3. **Validação ampla pós-cutover completo:** Playwright headless rolando a loja inteira do topo ao fim
   (dispara todos os `LazySection`/`loading="lazy"`) — 28 cards renderizados no DOM, **0 imagem quebrada**
   (`naturalWidth===0`), 0 request de Storage com erro, 0 erro de console/JS.

**Total combinado (piloto + restante):** 38 produtos, **54.501,3KB → 2.981,0KB (−95%)** — bate com o
dry-run original quase ao byte. Log de reversão de cada fase commitado no repositório (auditoria/rollback
futuro): `reprocess-product-images.revert.1786038246002.json` (piloto) e
`reprocess-product-images.revert.1786039374075.json` (restante).

## 4. O que NÃO mudou / avaliado e descartado

- Arquitetura de dados (`DataService`, hooks, cache-first + sync paralelo) — já estava correta (§2.6).
- `@supabase/supabase-js` embute Realtime/Storage/Functions/WebAuthn (~700KB fonte) mesmo sem uso de
  Realtime/WebAuthn nesta app — **decisão: não mexer**. Exigiria trocar o SDK oficial por peças soltas
  (`@supabase/postgrest-js` + `@supabase/gotrue-js` isolados), mudança de arquitetura de alto risco pra
  um ganho incerto (o cliente já minifica/gzipa bem — a maior parte do peso "fonte" não vira peso
  proporcional no bundle final). Contraria a instrução explícita da REF ("não alterar arquitetura sem
  necessidade").
- Onda D (Capacitor dynamic import) — ver §3.
- UX/regras de negócio/qualidade visual — nada disso mudou; toda otimização preserva o comportamento
  funcional exato (mesmas imagens, só redimensionadas/recomprimidas; mesmos componentes, só carregados
  sob demanda).

## 5. Benchmark antes/depois

Lighthouse mobile, simulate throttling, mesmo ambiente (`vite preview` + Edge headless) nas 3 rodadas —
baseline, depois das Ondas A-C (código, antes do cutover), e depois da Onda E (cutover completo):

| Métrica | Antes | Depois (A-C) | Depois (+ Onda E) |
|---|---|---|---|
| **Performance score** | 37/100 | 41/100 | **68/100** |
| First Contentful Paint | 2,1s | 2,0s | 2,1s |
| **Largest Contentful Paint** | **5,9s** | 4,4s | **4,3s** (−27%) |
| **Total Blocking Time** | 910ms | 970ms | **160ms** (−82%) |
| Cumulative Layout Shift | 0,3 | 0,302 | 0,256 |
| **Speed Index** | 4,9s | 5,9s | **3,1s** (−37%) |
| Time to Interactive | 8,1s | 7,1s | 6,9s |
| **Payload total** | 23,6 MB | 23,2 MB | **1,6 MB** (−93%) |

Confirma a leitura da auditoria: LCP/TTI já tinham melhorado com as Ondas A-C (banner descoberto mais
cedo, menos JS no caminho crítico), mas TBT/Speed Index/payload só destravaram de verdade depois do
cutover da Onda E — o catálogo inteiro carregando em resolução original é o que dominava essas métricas
(trabalho de CPU decodificando/pintando dezenas de MB de imagem, não bytes de JS). O resultado real bateu
com a projeção do dry-run (payload caiu ~22MB, perto do ~23,6MB→1,6MB observado, já contando os outros
assets também reduzidos nas Ondas A-C).

## 6. Testes executados

- `npm run test:render` (16 folhas, snapshot de markup) — verde; snapshot de `ValionCredit` atualizado
  (única mudança de markup real: `.png`→`.webp`).
- `npm run test:deps` (isolamento dos domínios `pricing.js`/`addons.js`) — verde; `import()` dinâmico não
  interfere no grafo estático (não é capturado pelo regex do scanner, por design).
- `npm run test:domain` (37 scripts golden/guard) — verde, exit code 0, zero regressão.
- `npm run build` (3 vezes, uma por onda relevante) — verde, sem warning de chunk >500KB depois da
  Onda C.
- Smoke interativo via Playwright headless (`chromium` de `@playwright/test`, script ad-hoc): abrir
  produto, abrir carrinho, abrir menu — todos os chunks lazy carregam, zero erro de console/rede.
- `scripts/reprocess-product-images.mjs`: dry-run (0 falhas/38), piloto `--apply --limit 2` (0 falhas,
  validado por fetch direto das URLs + inspeção visual + Playwright na loja real: card/modal/carrinho) e
  `--apply` do restante (0 falhas/36) — todos contra o Supabase de **produção** real.
- Validação ampla pós-cutover (Playwright, scroll completo da loja): 28 cards no DOM, 0 imagem quebrada
  (`naturalWidth===0`), 0 request de Storage com erro, 0 erro de console/JS.

## 7. Arquivos modificados

- `src/utils/imageCompression.js` (novo) · `src/components/admin/ImageUploader.jsx` (Onda A)
- `scripts/optimize-static-images.mjs` (novo) · `public/header-bg.webp`/`logo.webp`/`valion-mark.webp`
  (novos) · `index.html` · `src/pages/StoreApp.jsx` · `src/lib/supabase.js` ·
  `src/components/ValionCredit.jsx` (Onda B)
- `src/pages/StoreApp.jsx` · `src/components/menu/StoreMenu.jsx` (Onda C)
- `scripts/reprocess-product-images.mjs` (novo, Onda E: dry-run + apply + rollback) ·
  `reprocess-product-images.revert.*.json` (2 logs de reversão do cutover real, commitados)
- `tests/render.smoke.mjs` (snapshot atualizado) · `package.json`/`package-lock.json` (devDependency
  `sharp`, usada só em scripts de build/tooling — nunca entra no bundle do navegador)
- `products.imagem_url` de 38 linhas (produção, Supabase) — apontam agora pros arquivos `reprocessed_*`
  reprocessados; originais preservados no Storage, nunca apagados.

## 8. Impacto e próximos passos

REF concluída de ponta a ponta: uploads futuros já saem comprimidos (Onda A), os assets fixos do boot
pesam 78% menos (Onda B), o bundle inicial da loja carrega ~17KB gzip a menos de JS que ninguém usa na
1ª tela (Onda C), e as 38 imagens de produto já publicadas foram reprocessadas em produção com validação
em 2 fases (Onda E) — payload total da loja caiu de 23,6MB para 1,6MB (−93%), Performance Lighthouse
37→68/100. Nenhuma regressão encontrada em nenhuma fase (testes automatizados + validação visual manual
+ Playwright). Próximo passo é só operacional: push dos 8 commits locais (autorizado pelo dono,
condicionado à validação completa — cumprida) e, mais adiante, uma limpeza deliberada dos arquivos
originais órfãos no Storage (fora de escopo desta REF — não há pressa, eles não são mais referenciados
por nenhum produto e não pesam no boot da loja).
