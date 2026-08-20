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
    /* REF-SENTRY-01 · Onda 6: monitoramento básico de performance (Web Vitals + navegação/transações),
       recomendação oficial do Sentry. Amostragem conservadora ("sem exageros") — ajustável aqui sem
       tocar em mais nada caso o volume real observado no painel peça outro valor. Session Replay/
       Profiling permanecem DE FORA (fora de escopo desta REF, e nenhum dos dois é habilitado por
       tracesSampleRate/integrations abaixo). */
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.2,
    /* REF-SEC-DATA-01 R17: o SDK captura console.log/warn/error como breadcrumb por padrão (integração
       Breadcrumbs, embutida — `integrations` acima SOMA a esse conjunto default, nunca o substitui) e
       anexa isso a QUALQUER erro reportado depois, mesmo sem relação nenhuma com o log. Achado real:
       3 console.log de depuração esquecidos logavam o carrinho inteiro (produto/adicionais/observação
       livre do cliente) — removidos nesta mesma correção, mas a causa raiz é a captura automática em si.
       Descartar so a categoria 'console' fecha a classe inteira: qualquer console.log futuro que alguém
       esquecer de remover não vaza mais pro Sentry, sem precisar caçar cada ocorrência de novo. Outras
       categorias (ex.: 'negocio', ver registrarBreadcrumb abaixo) continuam intactas. */
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      return breadcrumb;
    },
  });

  /* REF-SENTRY-01 · Onda 2 ("Resource Loading Errors"): falha de carregamento de <img>/<script>/<link>
     NÃO é capturada pelo GlobalHandlers do SDK (o evento 'error' de recurso não tem `.error`/`.message`,
     só dispara na fase de CAPTURA, nunca faz bubble até window.onerror comum) — por isso precisa de um
     listener dedicado, registrado uma única vez aqui (mesmo padrão "captura global" do resto do módulo).
     Filtra por `target !== window` para nunca duplicar erros de SCRIPT em runtime (esses sim already
     chegam via GlobalHandlers) — só recurso (imagem/script/css/etc. que falhou o load). */
  window.addEventListener('error', (event) => {
    const alvo = event?.target;
    if (!alvo || alvo === window || !(alvo.tagName)) return;
    Sentry.withScope((scope) => {
      scope.setTag('app.origem', 'recurso');
      scope.setContext('recurso', {
        tag: alvo.tagName,
        src: alvo.src || alvo.href || null,
      });
      Sentry.captureMessage(`Falha ao carregar recurso: ${alvo.tagName}`, 'warning');
    });
  }, true); // capture phase — obrigatório para recurso (não faz bubble)
}

/** Reporta ao Sentry um erro pego por um Error Boundary — no-op se Sentry não estiver ativo. */
export function capturarErroReact(err, info) {
  if (!sentryAtivo) return;
  Sentry.withScope((scope) => {
    if (info?.componentStack) scope.setContext('react', { componentStack: info.componentStack });
    Sentry.captureException(err);
  });
}

/** Reporta uma falha REAL de acesso a dados (RPC/rede) capturada em DataService.run — nunca erros
    lógicos esperados do Supabase (esses chegam em `res.error` e são tratados pelo chamador sem lançar;
    só o que de fato virou exceção passa por aqui). No-op se Sentry não estiver ativo. */
export function capturarErroDados(err, contexto) {
  if (!sentryAtivo) return;
  Sentry.withScope((scope) => {
    scope.setTag('app.origem', 'dados');
    if (contexto) scope.setContext('dados', contexto);
    Sentry.captureException(err);
  });
}

/** Reporta um DENY fail-closed de isolamento tenant (create_order/save_structured_address —
    REF-ORDER-TENANT-01/REF-ADDRESS-STOREID-01: 'loja invalida'/'loja nao identificada'). Nível
    'warning' (não exception) de propósito: um DENY isolado é comportamento ESPERADO (tentativa
    forjada, domínio não reconhecido) — não é uma falha da aplicação. `contexto.hostname` (technical,
    nunca PII) é o que permite ao painel do Sentry distinguir os dois cenários: volume de DENY vindo de
    hostnames que NÃO são os nossos (ruído de fundo esperado) vs. qualquer DENY vindo de um hostname
    real de produção (`*.valionsistemas.com.br`) — isso sim seria inesperado (config/infra/regressão) e
    vale investigar. No-op se Sentry não estiver ativo. */
export function capturarDenyTenant(motivo, contexto) {
  if (!sentryAtivo) return;
  Sentry.withScope((scope) => {
    scope.setTag('app.origem', 'tenant_deny');
    scope.setTag('deny.motivo', motivo);
    scope.setContext('tenant_deny', { motivo, ...contexto });
    Sentry.captureMessage(`Tenant DENY: ${motivo}`, 'warning');
  });
}

/** Marca o pedido atual como TAG pesquisável em qualquer evento subsequente da mesma sessão — ajuda a
    achar no Sentry todos os erros próximos a um pedido específico (ex.: relatado pelo cliente/WhatsApp). */
export function marcarPedido(orderId) {
  if (!sentryAtivo || !orderId) return;
  Sentry.setTag('order.id', orderId);
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
