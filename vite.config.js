import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';

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
export default defineConfig({
  base: '/encanto/',
  plugins: [
    react(),
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
