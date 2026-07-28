import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';

/* REF-OBS-01: identificador de release, usado tanto no bundle (Sentry.init) quanto no upload de source
   maps (sentryVitePlugin) — as DUAS pontas precisam do MESMO valor para o stack trace remoto casar com
   o arquivo certo. Vercel injeta VERCEL_GIT_COMMIT_SHA automaticamente no build; 'dev' é o fallback local
   (sem CI/Vercel), nunca undefined. */
const RELEASE = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || 'dev';

/* Upload de source maps é OPCIONAL: só roda se as credenciais do Sentry existirem no ambiente de build
   (SENTRY_AUTH_TOKEN/ORG/PROJECT — nunca prefixo VITE_, pois são segredos de build, não do bundle do
   navegador). Sem elas, o build segue idêntico a antes desta REF — mesmo padrão de degradação usado
   pelos secrets de E2E (REF-CI-01): funcionalidade ausente, build nunca quebra. */
const sentryUploadPronto = !!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

/* REF-SENTRY-01 (achado da auditoria/validação): o próprio sentryVitePlugin, quando os 3 vars acima
   existem, JÁ associa commits (release.setCommits, git local) e registra um deploy (release.deploy,
   env `vercel-${VERCEL_TARGET_ENV}`) automaticamente ao rodar dentro da Vercel (detecta via
   process.env.VERCEL/VERCEL_TARGET_ENV/VERCEL_GIT_*) — nenhum código adicional necessário aqui.
   Confirmado end-to-end (build local replicando os env vars da Vercel + API do Sentry): upload de
   source maps, commitCount e deployCount corretos. Se um release novo aparecer no Sentry sem commits/
   deploy, o problema NÃO é este arquivo — é SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT ausentes nas
   env vars do PROJETO NA VERCEL (Project Settings → Environment Variables → Production). */

/* REF-BRAND-01: app passa a ser servido sob o sub-path /encanto/ (dominio institucional
   valionsistemas.com.br na raiz e' a landing nova; /encanto e' este app, via proxy/rewrite no
   projeto Vercel da landing). `base` faz o Vite prefixar toda referencia a asset gerada
   (index.html, imports ES) com /encanto/ — padrao oficial do Vite pra deploy em sub-path.
   `outDir: 'dist/encanto'` faz a SAIDA FISICA do build bater exatamente com a URL, sem precisar
   de rewrite nenhum dentro do proprio projeto Vercel do Encanto (outputDirectory continua 'dist',
   ver vercel.json). Afeta tambem dev/preview/e2e local: tudo passa a servir sob /encanto/. */
/* REF-MOBILE-01 Onda 6: Service Worker via vite-plugin-pwa (Workbox por baixo) — escolhido em vez de um
   SW escrito a mao porque o precache manifest com hash (invalidacao correta a cada deploy) e' gerado e
   mantido pela propria ferramenta, reduzindo a superficie do maior risco desta REF (usuario preso numa
   versao velha por cache indevido).
   - manifest:false -> NAO gera manifest.webmanifest nem injeta <link rel="manifest">: o publico/manifest.json
     proprio (Onda 1) + o <link> proprio em index.html (ja commitados/validados) permanecem intocados;
     este plugin cuida SO do Service Worker.
   - registerType:'prompt' + injectRegister:false -> nada e' ativado sozinho; o registro roda manualmente
     (src/hooks/usePwaUpdate.js, chamado por App.jsx) via `virtual:pwa-register`, exibindo um aviso "nova
     versao disponivel" (reaproveita components/ui/Toast.jsx) ANTES de trocar de versao — nunca um reload
     forcado/silencioso no meio de um checkout.
   - SEM nenhuma entrada de runtimeCaching: por design do Workbox, uma rota so e' interceptada
     (event.respondWith) se casar com o precache ou com um runtimeCaching explicito — qualquer request que
     nao apareca aqui (Supabase REST/Auth, accounts.google.com no redirect do OAuth) passa direto pra rede,
     como se o SW nao existisse. So o "App Shell" (JS/CSS/HTML/icones do build, tudo com hash) e' cacheado.
   - devOptions.enabled:false (default) -> SW nunca ativa em `vite dev`/`vite --mode e2e` (webServer do
     Playwright usa dev server, nao build) - suite E2E roda 100% sem Service Worker, zero risco de
     interferencia nos specs existentes. */
const pwaPlugin = VitePWA({
  registerType: 'prompt',
  injectRegister: false,
  manifest: false,
  strategies: 'generateSW',
  filename: 'sw.js',
  devOptions: { enabled: false },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webmanifest,json}'],
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    clientsClaim: true,
  },
});

export default defineConfig({
  base: '/encanto/',
  plugins: [
    react(),
    pwaPlugin,
    ...(sentryUploadPronto ? [sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ['dist/encanto/**/*.map'] }, // sobe pro Sentry, nunca fica público no dist (REF-BRAND-01: outDir mudou)
    })] : []),
  ],
  define: {
    __APP_RELEASE__: JSON.stringify(RELEASE),
  },
  build: {
    outDir: 'dist/encanto',
    // Só gera .map quando há credencial pra subir pro Sentry E apagar do dist depois (plugin acima) —
    // sem isso, gerar .map deixaria o mapa do código-fonte publicamente acessível no Vercel (adivinhando
    // a URL), sem nenhum benefício (ninguém pra consumi-lo). 'hidden' = sem sourceMappingURL no JS final
    // (não some sozinho pro navegador; só existe pro upload).
    sourcemap: sentryUploadPronto ? 'hidden' : false,
  },
  server: {
    port: 5173,
    open: true,
  },
});
