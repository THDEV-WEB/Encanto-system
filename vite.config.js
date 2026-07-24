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

// Config mínima — apenas o plugin React (JSX). Nada de mágica adicional
// para manter o comportamento o mais próximo possível do sistema atual.
export default defineConfig({
  plugins: [
    react(),
    ...(sentryUploadPronto ? [sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: RELEASE },
      sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] }, // sobe pro Sentry, nunca fica público no dist
    })] : []),
  ],
  define: {
    __APP_RELEASE__: JSON.stringify(RELEASE),
  },
  build: {
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
