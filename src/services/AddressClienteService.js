/* services/AddressClienteService.js — REF-ADDRESS-UX-01.
   Leitura dos ENDEREÇOS RECENTES do PRÓPRIO cliente autenticado. Mesmo molde de
   PedidosClienteService.js (REF-CLIENTE-02): usa dbCliente (sessão do cliente — a RLS da
   REF-ADDRESS-SEC-01 já restringe a tabela ao próprio customer_id via auth.uid()) e ALÉM disso filtra
   sempre por customer_id explícito — nunca confia só na RLS. SOMENTE LEITURA.

   Dedupe (rua+numero+complemento+cep) é feito AQUI, em memória, sobre um lote um pouco maior que o
   exibido — decisão explícita (ver auditoria) de NÃO criar RPC/view nova só para isso: cada
   confirmação de endereço no checkout grava uma linha nova (comportamento já existente, inalterado),
   e a leitura agrupa por "mesmo endereço" mantendo a ocorrência mais recente (a query já vem ordenada
   por created_at DESC, então a primeira ocorrência de cada chave já É a mais recente) — reaproveitar
   um endereço automaticamente "sobe" ele pro topo, sem UPDATE, sem coluna nova, zero migration. */
import { dbCliente } from '../lib/dbCliente.js';
import { deduplicarRecentes } from '../address/utils/addressFormat.js';

const SEL = 'id, rua, numero, bairro, cidade, estado, cep, complemento, referencia, latitude, longitude, confidence, provider, formatted_address, created_at';
const LOTE_BRUTO = 20;     // busca mais que o exibido pra sobrar o suficiente após deduplicar
const LIMITE_EXIBIDO = 5;  // Fase 2 do pedido: 5 endereços recentes

export const AddressClienteService = {
  disponivel: () => !!dbCliente,

  /* Últimos endereços distintos do próprio cliente (mais recente primeiro), já deduplicados
     (deduplicarRecentes é pura, testada em isolamento — ver tests/address-recentes.golden.mjs). */
  async recentes(customerId) {
    if (!dbCliente || !customerId) return [];
    const { data, error } = await dbCliente
      .from('addresses')
      .select(SEL)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(LOTE_BRUTO);
    if (error) { console.warn('[AddressCliente] recentes:', error.message); return []; }
    return deduplicarRecentes(data ?? [], LIMITE_EXIBIDO);
  },
};
