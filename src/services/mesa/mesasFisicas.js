/* services/mesa/mesasFisicas.js — REF-MESA-02 · Onda 4.
   Catálogo de mesas físicas por loja (public.mesas) — CRUD mínimo via RPCs SECURITY DEFINER
   (admin_listar_mesas/admin_criar_mesa/admin_set_mesa_status). Espelha o padrão de chamada de
   services/loyalty/index.js: sempre via buildStoreRpcParam() (bundle Admin, respeita loja ativa
   no seletor multi-loja), nunca insert direto na tabela. */
import { db } from '../../lib/supabase.js';
import { buildStoreRpcParam } from '../resolveStoreParam.js';

export async function listarMesas() {
  if (!db) return [];
  const { data, error } = await db.rpc('admin_listar_mesas', buildStoreRpcParam());
  if (error || !Array.isArray(data)) return [];
  return data;
}

export async function criarMesa(identificador) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_criar_mesa', { p_identificador: identificador, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

export async function setMesaStatus(mesaId, status) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_set_mesa_status', { p_mesa_id: mesaId, p_status: status, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 8: total/consulta da conta corrente de uma mesa com sessao aberta -- so
   leitura, nenhum side effect (a RPC e' STABLE). */
export async function consultarContaMesa(identificador) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_consultar_conta_mesa', { p_mesa_identificador: identificador, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 9: move uma sessao aberta de uma mesa fisica pra outra (cliente mudou de
   lugar) sem fechar nada -- sessao/pedidos/total continuam os mesmos. */
export async function trocarMesaSessao(mesaSessionId, novoIdentificador) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_trocar_mesa_sessao', { p_mesa_session_id: mesaSessionId, p_novo_identificador: novoIdentificador, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 10: junta uma mesa fisica LIVRE a uma sessao ja aberta -- as duas ficam
   ocupadas pela MESMA sessao/conta simultaneamente (nao substitui, diferente da troca). */
export async function juntarMesaSessao(mesaSessionId, identificadorAdicional) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_juntar_mesa_sessao', { p_mesa_session_id: mesaSessionId, p_identificador_adicional: identificadorAdicional, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 11: encerra a sessao (cliente pagou e foi embora) -- libera TODAS as mesas
   associadas (inclusive juntadas/trocadas). paymentMethod pode ser null quando o total for 0. */
export async function fecharContaMesa(mesaSessionId, paymentMethod) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_fechar_conta_mesa', { p_mesa_session_id: mesaSessionId, p_payment_method: paymentMethod || null, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 17 (RPC ja existia desde REF-PAGAMENTO-01 · Onda 1, sem consumidor de UI ate
   agora): propoe N fatias (valor+metodo) pra dividir a conta -- servidor valida que a soma bate
   EXATAMENTE com o total real (nunca confia em arredondamento do cliente). alocacoes: [{valor, metodo}]. */
export async function dividirContaMesa(mesaSessionId, alocacoes) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_dividir_conta_mesa', { p_mesa_session_id: mesaSessionId, p_alocacoes: alocacoes, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 17: marca 1 fatia da divisao como paga. admin_fechar_conta_mesa so aceita
   fechar a sessao quando TODAS as fatias estiverem 'pago'. */
export async function registrarPagamentoAlocacao(alocacaoId, metodo) {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_registrar_pagamento_alocacao', { p_alocacao_id: alocacaoId, p_metodo: metodo, ...buildStoreRpcParam() });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 15: URL publica da propria loja, resolvida no servidor (Admin nao tem acesso
   a stores.slug/dominio por outro caminho) -- usada junto com mesas[].qr_token pra montar o link
   do QR (?mesa_token=<uuid>, mesmo parametro que useMesaFromQuery.js le desde a Onda 5). */
export async function obterUrlStorefront() {
  if (!db) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('admin_obter_url_storefront', buildStoreRpcParam());
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 5 (QR protegido): RPC publica (guest escaneando o QR, sem sessao/loja
   selecionada ainda) -- por isso NUNCA usa buildStoreRpcParam() aqui, o token sozinho ja resolve a
   loja no servidor. Nunca confiar no numero da mesa da URL crua -- so o que este RPC devolve. */
export async function resolverMesaPorToken(qrToken) {
  if (!db || !qrToken) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('resolver_mesa_por_token', { p_qr_token: qrToken });
  if (error) return { ok: false, error: error.message };
  return data;
}

/* REF-MESA-02 · Onda 18: cliente ve (SO LEITURA -- decisao explicita do dono, sem pagamento/divisao
   pelo cliente) os pedidos+total acumulados da propria mesa. Mesmo padrao de seguranca/publica de
   resolverMesaPorToken acima -- SO pelo qr_token opaco, nunca por mesa_identificador (evita reabrir o
   mesmo achado de enumeracao que a Onda 5 ja fechou). */
export async function consultarMinhaContaMesa(qrToken) {
  if (!db || !qrToken) return { ok: false, error: 'offline' };
  const { data, error } = await db.rpc('consultar_minha_conta_mesa', { p_qr_token: qrToken });
  if (error) return { ok: false, error: error.message };
  return data;
}
