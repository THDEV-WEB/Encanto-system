/* address/services/viaCepService.js — REF-ADDRESS-01.
   Cliente HTTP do ViaCEP (API brasileira oficial de CEP). FONTE ÚNICA da consulta de CEP: nenhum
   componente faz fetch de CEP direto (era inline no AddressModal.buscarCEP). Camada de I/O pura, sem
   React. Preserva EXATAMENTE a URL e o contrato originais (comportamento inalterado).

   Cache: memo em memória (por sessão) das RESPOSTAS de acerto — otimização que reduz chamadas quando o
   mesmo CEP é consultado de novo (reabrir modal, limpar+redigitar). NUNCA é fonte de verdade: só guarda
   o que o ViaCEP devolveu, é re-derivável a qualquer momento e erros/timeout NÃO são memoizados (a
   próxima tentativa vai à rede). Limite simples para não crescer sem fim. */

const ENDPOINT = 'https://viacep.com.br/ws/';   // BYTE-IGUAL ao literal original
const CACHE_MAX = 60;
const cache = new Map();   // '8 dígitos' -> resposta ViaCEP (só acertos)

function memoizar(chave, valor) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);   // evita crescimento ilimitado
  cache.set(chave, valor);
}

/* Consulta o CEP (8 dígitos). Devolve a resposta bruta do ViaCEP ({logradouro,bairro,localidade,uf,cep,...}
   ou {erro:true}), ou null se o CEP não tiver 8 dígitos (mesma guarda do componente original, que
   retornava sem tocar em nada). Lança em falha de rede — o chamador trata (igual ao try/catch original). */
export async function consultarCep(cep) {
  const c = String(cep || '').replace(/\D/g, '');
  if (c.length !== 8) return null;
  if (cache.has(c)) return cache.get(c);
  const r = await fetch(ENDPOINT + c + '/json/');
  const d = await r.json();
  if (d && !d.erro) memoizar(c, d);   // só memoiza acerto; "não encontrado" continua re-tentável
  return d;
}

/* Exposto p/ teste/observabilidade — nunca usado como verdade. */
export function _limparCacheCep() { cache.clear(); }
