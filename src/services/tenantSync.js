/* services/tenantSync.js — REF-AUTH-TENANT-01 · Onda 4.
   Mantém o claim `tenant_id` do JWT da sessão do cliente em dia com a loja resolvida por domínio.
   Puro e testável sem rede: recebe o client (dbCliente) por parâmetro, nunca importa React. Mesmo
   módulo é usado pelo hook do storefront (useTenantSync.js) E pelo script de validação real contra o
   projeto E2E — garante que o que é testado é exatamente o que roda em produção.

   Fluxo: activate_tenant(storeId) [SECURITY DEFINER, valida customer+loja server-side, Onda 2] ->
   refreshSession() [dispara o Custom Access Token Hook de novo, Onda 3] -> onAuthStateChange do
   próprio dbCliente atualiza a sessão sozinho (React) ou o caller relê session() (Node). Nunca lança —
   best-effort, mesmo padrão de outras sincronizações silenciosas já existentes (atualizarNome). */
import { decodeJwtPayload } from '../utils/jwt.js';

/** true quando o tenant do JWT atual já bate com a loja resolvida (nada a fazer) — decisão pura,
    sem I/O, usada tanto pra decidir quanto pra testar convergência (não deve haver loop). */
export function precisaAtivarTenant({ accessToken, storeId, storeStatus }) {
  if (!accessToken || !storeId || storeStatus !== 'ativo') return false;
  const claims = decodeJwtPayload(accessToken);
  return claims?.tenant_id !== storeId;
}

/** Sincroniza o tenant da sessão atual com a loja resolvida. Guarda dupla contra loop/duplicação:
    (1) precisaAtivarTenant já evita chamar de novo quando o claim já está correto — o próprio
        refreshSession() faz o efeito convergir sozinho (novo token já correto -> próxima checagem
        vê "nada a fazer"); (2) o caller (useTenantSync.js) some com um ref de "em andamento" pra
        cobrir a janela assíncrona entre disparos concorrentes do efeito.
    Silencioso de propósito: falha de ativação (sem vínculo com a loja, loja inativa, etc.) é uma
    NEGAÇÃO LEGÍTIMA (Onda 2) — a sessão simplesmente continua sem tenant_id, nunca trava a UI nem
    tenta de novo sozinha (só quando session/store mudarem de verdade). Não chama refreshSession()
    se activate_tenant falhou — nada mudou pra buscar. */
export async function syncTenant({ dbCliente, accessToken, storeId, storeStatus }) {
  if (!dbCliente || !precisaAtivarTenant({ accessToken, storeId, storeStatus })) return { ativado: false };
  const { error: erroActivate } = await dbCliente.rpc('activate_tenant', { p_store_id: storeId });
  if (erroActivate) {
    console.warn('[Encanto] activate_tenant:', erroActivate.message);
    return { ativado: false, error: erroActivate };
  }
  const { error: erroRefresh } = await dbCliente.auth.refreshSession();
  if (erroRefresh) {
    console.warn('[Encanto] refreshSession pos-activate_tenant:', erroRefresh.message);
    return { ativado: false, error: erroRefresh };
  }
  return { ativado: true };
}
