/* address/repository/addressRepository.js — REF-ADDRESS-02 · Onda 2.
   Única camada que persiste o endereço estruturado (tabela `addresses`, migration Onda 1). Espelha
   exatamente o padrão de DataService.savePedido (mesmo cliente `db` de lib/supabase.js — a mesma
   instância que create_order usa, porque save_structured_address é chamada por visitante e cliente
   logado igual, sem depender de sessão; mesmo timeout defensivo via RPC_TIMEOUT). Nunca lança em falha
   de rede — devolve null e loga, quem chama decide o que fazer (mesmo contrato de savePedido).

   Ainda não é consumida por nenhuma UI/checkout (isso é a Onda 6) — existe isolada, pronta e testável
   por estrutura (tests/address.guard.mjs), sem mudar nenhum comportamento hoje. */
import { db, RPC_TIMEOUT } from '../../lib/supabase.js';

/* Exportada só para teste (REF-ADDRESS-AUTOCOMPLETE-01): prova o shape exato que salvar() manda pra
   RPC, incluindo o achado da auditoria de que store_id nunca é incluído — ver
   tests/address-multitenant.golden.mjs. Nenhuma mudança de comportamento aqui. */
export function paraPayloadRpc(endereco) {
  const e = endereco || {};
  return {
    customer_id: e.customerId ?? null,
    rua: e.rua || null,
    numero: e.numero || null,
    bairro: e.bairro || null,
    cidade: e.cidade || null,
    complemento: e.complemento || null,
    estado: e.estado || null,
    cep: e.cep || null,
    referencia: e.referencia || null,
    latitude: e.lat ?? null,
    longitude: e.lng ?? null,
    place_id: e.placeId || null,
    formatted_address: e.full || null,
    provider: e.provider || null,
    confidence: e.confidence || null,
  };
}

export const addressRepository = {
  /* Grava o endereço estruturado (objeto canônico de addressModel.js) via RPC SECURITY DEFINER
     save_structured_address. Retorna o uuid criado, ou null em erro/offline (nunca lança). */
  async salvar(endereco) {
    if (!db) { console.warn('[Encanto] addressRepository.salvar: Supabase indisponível (offline).'); return null; }
    const p_address = paraPayloadRpc(endereco);
    const call = () => db.rpc('save_structured_address', { p_address });
    const withTimeout = (p) => Promise.race([p,
      new Promise((res) => setTimeout(() => res({ data: null, error: { message: 'timeout' } }), RPC_TIMEOUT))]);
    const r = await withTimeout(call());
    if (r.error) { console.error('[Encanto] save_structured_address erro:', r.error.message || r.error); return null; }
    return r.data ?? null;
  },
};
