/* lib/sentry.js — REF-OBS-01. Observabilidade de erros em produção (Sentry).
   Mesmo padrão de lib/supabase.js: config via VITE_*, singleton, modo degradado se a env var não
   existir (aqui, "degradado" = Sentry nunca é inicializado — zero custo, zero rede, zero mudança de
   comportamento). Sem VITE_SENTRY_DSN (local, E2E, ou enquanto o dono não criar o projeto no Sentry),
   `sentryAtivo` fica false e toda função exportada deste módulo vira no-op.

   O SDK do browser (Sentry.init) já instala sozinho, por padrão, os handlers globais de
   window.onerror/unhandledrejection e breadcrumbs de console/fetch/click/navegação — não há necessidade
   de reimplementar nenhum desses aqui. O que este módulo adiciona por cima:
   - capturarErroReact(): ponte pros Error Boundaries já existentes (main.jsx, ProductModalBoundary) —
     eles continuam com seu próprio fallback visual; isto só reporta o erro capturado.
   - setUsuario()/limparUsuario(): contexto de quem está logado, chamado pelos providers de sessão
     (cliente/admin) — NUNCA telefone/nome (só id + role), para não colocar dado pessoal no Sentry. */
import * as Sentry from '@sentry/react';

/* Acesso DIRETO (sem ?.) de propósito: é o padrão exato que o Vite substitui em build por um literal
   ("" quando a env var não existe) — só assim o minificador enxerga `sentryAtivo` como constante
   `false` e elimina TODO o SDK do Sentry por dead-code quando VITE_SENTRY_DSN não está setado (medido:
   +0,24 kB no bundle sem DSN vs +89 kB com). `import.meta.env?.X` quebraria essa otimização (vira uma
   leitura de objeto em runtime, não mais uma constante de build) — ver tests/_render-loader.mjs para
   como isto é tornado seguro em Node puro (fora do Vite) sem sacrificar o ganho aqui. */
const DSN = import.meta.env.VITE_SENTRY_DSN;
export const sentryAtivo = !!DSN;

if (sentryAtivo) {
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE, // 'development' | 'production' | 'e2e' (vite --mode e2e)
    release: typeof __APP_RELEASE__ !== 'undefined' ? __APP_RELEASE__ : 'dev', // ver vite.config.js
  });
}

/** Reporta ao Sentry um erro pego por um Error Boundary — no-op se Sentry não estiver ativo. */
export function capturarErroReact(err, info) {
  if (!sentryAtivo) return;
  Sentry.withScope((scope) => {
    if (info?.componentStack) scope.setContext('react', { componentStack: info.componentStack });
    Sentry.captureException(err);
  });
}

/** Marca a área do app (loja/admin) em todo evento subsequente — ajuda a filtrar no Sentry. */
export function marcarArea(area) {
  if (!sentryAtivo) return;
  Sentry.setTag('app.area', area);
}

/** Contexto do usuário ATUAL — só identificadores, nunca telefone/nome/e-mail de cliente (PII). */
export function setUsuario(id, extra) {
  if (!sentryAtivo || !id) return;
  Sentry.setUser({ id, ...extra });
}

/** Limpa o contexto de usuário (logout). */
export function limparUsuario() {
  if (!sentryAtivo) return;
  Sentry.setUser(null);
}

/** Breadcrumb de um evento de negócio relevante (ex.: checkout finalizado, login admin). */
export function registrarBreadcrumb(mensagem, dados) {
  if (!sentryAtivo) return;
  Sentry.addBreadcrumb({ category: 'negocio', message: mensagem, data: dados, level: 'info' });
}
