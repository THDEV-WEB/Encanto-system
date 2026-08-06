# ADR REF-PERF-01 — Performance de inicialização (startup performance)

**Status:** Implementada no código (Ondas A–D); Onda E (reprocessamento das imagens de produto já
publicadas) com script pronto e **dry-run executado** — cutover real (`--apply`) pendente de decisão/
execução do dono (exige `SUPABASE_SERVICE_ROLE_KEY`, que este ambiente não tem por design).
**Depende de:** nenhuma REF anterior especificamente — toca a loja inteira (boot, catálogo, checkout,
menu) e o pipeline de upload de imagem do Admin (`ImageUploader.jsx`, REF-APP-01 · Onda 6.3).
**Push/deploy:** commits locais, push não realizado (aguardando pedido explícito, mesma disciplina do
resto do projeto).

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

### Onda E — reprocessamento das imagens de produto já publicadas (script pronto; cutover pendente)

O maior gargalo medido (§2.1) só se resolve reprocessando o que **já está** no Storage — Onda A cobre
só uploads futuros. `scripts/reprocess-product-images.mjs`:

- **Modo padrão = dry-run**: lê `products` com o client **anônimo** (mesma permissão que a própria loja
  usa pra listar o catálogo), baixa cada imagem pela URL pública, mede antes/depois com `sharp`
  (mesmo alvo da Onda A: 1280px, aqui reencodado WebP qualidade 80). Nada é gravado.
- **Modo `--apply`**: sobe a versão reprocessada como **arquivo novo** no bucket (nunca apaga/sobrescreve
  o original) e só então faz `UPDATE products.imagem_url`. Exige `SUPABASE_SERVICE_ROLE_KEY` em
  `.env.local` (gitignored) porque `products.UPDATE` é restrito a `is_admin()` via RLS
  (`AUTH-01-step2-harden-rls.sql`) — a anon key nunca teria permissão, e essa chave de escrita **não
  existe neste ambiente de desenvolvimento**, por desenho (mesmo padrão já usado pelos scripts de E2E
  deste projeto: credenciais de escrita de produção nunca ficam no alcance do agente/repo). Grava um log
  JSON (id + url antiga + url nova) antes de cada `UPDATE`, pra reversão manual se necessário.

**Resultado do dry-run (executado, real, contra produção):** 38 produtos, **53,2 MB → 2,9 MB (−95%)**,
0 falhas. Cutover (`--apply`) depende do dono rodar o script com a service role key (ou fornecê-la para
rodar por aqui) — ver `scripts/reprocess-product-images.mjs` para o passo a passo.

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

Lighthouse mobile, simulate throttling, mesmo ambiente (`vite preview` + Edge headless), medido após as
Ondas A–C (Onda E ainda não aplicada em produção — os 53,2MB de imagem de produto continuam no ar até o
cutover):

| Métrica | Antes | Depois (A-C) |
|---|---|---|
| Performance score | 37/100 | 41/100 |
| First Contentful Paint | 2,1s | 2,0s |
| **Largest Contentful Paint** | **5,9s** | **4,4s** (−25%) |
| Total Blocking Time | 910ms | 970ms |
| Cumulative Layout Shift | 0,3 | 0,302 |
| Speed Index | 4,9s | 5,9s |
| Time to Interactive | 8,1s | 7,1s |
| Payload total | 23,6 MB | 23,2 MB |

LCP e TTI melhoraram de forma consistente com as ondas de código (banner descoberto mais cedo + menos JS
no caminho crítico). TBT/Speed Index/payload continuam dominados pelos 53,2MB de imagens de produto
ainda não reprocessadas (Onda E) — são métricas mais sensíveis a trabalho de CPU/bytes de imagem do que
a bytes de JS, e o catálogo inteiro ainda carrega em resolução original enquanto o cutover não roda.
**Projeção pós-Onda E** (baseado no dry-run real, −95% no peso do catálogo): payload cai em ~50MB,
LCP/TBT/Speed Index devem melhorar substancialmente mais — o maior lance de toda a auditoria está
represado nessa onda.

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
- `scripts/reprocess-product-images.mjs` (dry-run) contra o Supabase de **produção** — só leitura,
  0 falhas em 38 imagens.

## 7. Arquivos modificados

- `src/utils/imageCompression.js` (novo) · `src/components/admin/ImageUploader.jsx` (Onda A)
- `scripts/optimize-static-images.mjs` (novo) · `public/header-bg.webp`/`logo.webp`/`valion-mark.webp`
  (novos) · `index.html` · `src/pages/StoreApp.jsx` · `src/lib/supabase.js` ·
  `src/components/ValionCredit.jsx` (Onda B)
- `src/pages/StoreApp.jsx` · `src/components/menu/StoreMenu.jsx` (Onda C)
- `scripts/reprocess-product-images.mjs` (novo, Onda E)
- `tests/render.smoke.mjs` (snapshot atualizado) · `package.json`/`package-lock.json` (devDependency
  `sharp`, usada só em scripts de build/tooling — nunca entra no bundle do navegador)

## 8. Impacto e próximos passos

Ondas A-D fecham a REF no código: uploads futuros já saem comprimidos, os assets fixos do boot pesam
78% menos, e o bundle inicial da loja carrega ~17KB gzip a menos de JS que ninguém usa na 1ª tela. O
maior ganho absoluto da auditoria inteira (Onda E, −95% no peso do catálogo) está pronto e testado em
dry-run, mas **depende de decisão do dono** para o cutover real — ver `scripts/
reprocess-product-images.mjs` para instruções de `--apply`. Depois do cutover, recomenda-se rodar este
mesmo benchmark (Lighthouse antes/depois já documentado aqui) de novo para fechar o ciclo com o número
final.
