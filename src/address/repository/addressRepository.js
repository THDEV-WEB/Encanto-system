/* address/repository/addressRepository.js — REF-ADDRESS-02 · Onda 2.
   Única camada que persiste o endereço estruturado (tabela `addresses`, migration Onda 1). Mesmo
   timeout defensivo via RPC_TIMEOUT que DataService.savePedido usa. Nunca lança em falha de rede —
   devolve null e loga, quem chama decide o que fazer (mesmo contrato de savePedido).

   REF-AUTH-TENANT-01 · Onda 5 (correção): usava `db` (cliente do ADMIN, lib/supabase.js) — funciona
   pra convidado (RPC não depende de sessão pra customer_id=null), mas pra CLIENTE LOGADO fazia
   auth.uid() dentro da RPC ficar sempre NULL (db nunca carrega a sessão do cliente no bundle da loja),
   quebrando silenciosamente o vínculo customer_id em TODO save via checkout, logado ou não. Trocado
   pra `dbCliente` (mesma instância que AuthService/AuthProvider usam) — agora a RPC enxerga auth.uid()
   real quando a pessoa está logada, e continua funcionando igual pra convidado (dbCliente também
   funciona sem sessão, só não tem uid nenhum pra achar). */
import { dbCliente } from '../../lib/dbCliente.js';
import { RPC_TIMEOUT } from '../../lib/supabase.js';
import { capturarDenyTenant } from '../../lib/sentry.js';

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
    if (!dbCliente) { console.warn('[Encanto] addressRepository.salvar: Supabase indisponível (offline).'); return null; }
    const p_address = paraPayloadRpc(endereco);
    const call = () => dbCliente.rpc('save_structured_address', { p_address });
    const withTimeout = (p) => Promise.race([p,
      new Promise((res) => setTimeout(() => res({ data: null, error: { message: 'timeout' } }), RPC_TIMEOUT))]);
    const r = await withTimeout(call());
    if (r.error) {
      console.error('[Encanto] save_structured_address erro:', r.error.message || r.error);
      /* REF-OBS-02: o DENY fail-closed de isolamento tenant (REF-ADDRESS-STOREID-01 Parte B) chega
         aqui como exceção do Postgres (RAISE EXCEPTION), não distinta de outras falhas de rede/validação
         a não ser pela mensagem exata — filtro por ela evita capturar qualquer outro erro (offline,
         timeout, payload inválido) como se fosse DENY de tenant. */
      if (r.error.message === 'loja nao identificada') {
        capturarDenyTenant(r.error.message, { rpc: 'save_structured_address', hostname: window.location.hostname });
      }
      return null;
    }
    return r.data ?? null;
  },
};
