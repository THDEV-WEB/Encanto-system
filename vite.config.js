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
/* REF-CAP-01 Onda 1: `disable` (parametro `desativado`, default false) e' a MESMA chave que ja' desliga o
   plugin em dev — usada aqui pra desligar tambem no build do Capacitor, SEM remover o plugin do array de
   plugins. Precisa continuar presente (so' desativado) porque `src/hooks/usePwaUpdate.js` faz
   `import('virtual:pwa-register')`: e' o proprio vite-plugin-pwa quem fornece esse modulo virtual — sem
   o plugin no array, o Rollup nao acha o import e o build quebra (testado: "Rollup failed to resolve
   import virtual:pwa-register"). Com `disable:true`, o modulo virtual continua resolvendo (como stub
   no-op), o hook roda normalmente e nunca ativa nada — zero comportamento de SW dentro do APK, com ZERO
   mudanca de codigo em runtime. */
/* REF-ADMIN-04 · Onda 1: parametros novos (filename/navigateFallback) só existem pra permitir uma 2a
   instância deste MESMO plugin pro bundle do admin (Onda 2 liga de vez, com manifest/nome próprios) —
   assinatura por posição preservada pros dois chamadores que já existiam (web e capacitor continuam
   passando só o 1o argumento, pegando os defaults de sempre). */
const buildPwaPlugin = (desativado, filename = 'sw.js', navigateFallback = 'index.html') => VitePWA({
  disable: desativado,
  registerType: 'prompt',
  injectRegister: false,
  manifest: false,
  strategies: 'generateSW',
  filename,
  devOptions: { enabled: false },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webmanifest,json}'],
    navigateFallback,
    cleanupOutdatedCaches: true,
    clientsClaim: true,
  },
});

/* REF-CAP-01 Onda 1 (Dual Build): UM SÓ arquivo de config — nunca um vite.config.capacitor.js paralelo —
   pra eliminar o risco de as duas saídas divergirem em silêncio com o tempo. `mode` (mecanismo nativo do
   Vite, `vite build --mode capacitor`) é o ÚNICO gate: fora dele (build/dev/preview/e2e — todo o resto do
   projeto, sem exceção) o resultado é BYTE A BYTE igual a antes desta REF. Os dois pontos que a auditoria
   da REF-CAP-01 identificou como incompatíveis entre o deploy Web (Vercel, sub-path) e o modelo de
   `webDir` do Capacitor (que serve o CONTEÚDO da pasta na raiz local do app) ficam isolados aqui:
   - `base:'/'` -> sem isso, o index.html do Capacitor pediria assets em `/encanto/...`, path que não
     existe na raiz do WebView local (só existe no servidor Vercel) — todo o JS/CSS 404aria dentro do APK.
   - Service Worker desativado (`buildPwaPlugin(true)`, ver acima) -> um Service Worker Workbox pressupõe
     "nova versão = novo fetch de rede"; dentro de um APK empacotado localmente essa premissa não existe
     (nova versão = novo APK instalado) — zero comportamento de PWA dentro do Capacitor. */
/* REF-ADMIN-04 · Onda 1: 3o valor de `mode` (`vite build --mode admin`), mesmo mecanismo de gate único
   já usado pelo `capacitor` (REF-CAP-01) — nunca um vite.config.admin.js paralelo, mesma razão de sempre
   (elimina o risco de as saídas divergirem em silêncio com o tempo). `base:'/'` porque o admin é servido
   na RAIZ do seu próprio domínio (subdomínio dedicado, ver ADR), nunca sob `/encanto/` — ao contrário do
   Capacitor (raiz local do WebView), aqui é raiz de um domínio Vercel de verdade.
   `rollupOptions.input` só é sobrescrito neste modo: web/capacitor continuam usando o default do Vite
   (o `index.html` da raiz), agora que `admin.html` também existe no repo — sem isso, o build da loja
   passaria a incluir os dois HTMLs juntos. */
export default defineConfig(({ mode }) => {
  const isCapacitor = mode === 'capacitor';
  const isAdmin = mode === 'admin';
  const outDir = isCapacitor ? 'dist/capacitor' : isAdmin ? 'dist/admin' : 'dist/encanto';

  return {
    base: (isCapacitor || isAdmin) ? '/' : '/encanto/',
    plugins: [
      react(),
      isAdmin
        ? buildPwaPlugin(false, 'sw-admin.js', 'admin.html') // REF-ADMIN-04 Onda 2: ligado — manifest próprio (public/manifest-admin.json) + link em admin.html
        : buildPwaPlugin(isCapacitor),
      ...(sentryUploadPronto ? [sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: [`${outDir}/**/*.map`] }, // sobe pro Sentry, nunca fica público no dist (REF-BRAND-01: outDir mudou)
      })] : []),
    ],
    define: {
      __APP_RELEASE__: JSON.stringify(RELEASE),
    },
    build: {
      outDir,
      rollupOptions: isAdmin ? { input: 'admin.html' } : undefined,
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
  };
});
