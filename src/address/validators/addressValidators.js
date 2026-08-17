/* address/validators/addressValidators.js — REF-ADDRESS-01.
   Regras de validação do domínio Address (puras, sem React/IO). FONTE ÚNICA das validações que antes
   viviam inline como condições soltas no AddressModal. Também endereçam o requisito de SEGURANÇA (não
   confiar em resposta externa): validar CEP, número e coordenadas antes de usar.

   Os validadores JÁ USADOS nos fluxos existentes reproduzem exatamente as guardas originais (zero mudança
   de comportamento). `coordenadasValidas` é fornecido e testado para o endurecimento do mapa/geocoding e a
   evolução futura (área de entrega/geofencing); NÃO é ligado aos fluxos atuais para não alterar
   comportamento (o original não rejeitava coordenadas). */

/* CEP: exatamente 8 dígitos (mesma guarda de `c.length !== 8` do buscarCEP original). */
export const cepValido = (cep) => String(cep || '').replace(/\D/g, '').length === 8;

/* Busca por texto: mínimo 3 caracteres (mesma guarda de `!q || q.length < 3`). */
export const queryValida = (q) => !!q && q.length >= 3;

/* Número da residência preenchido (mesma guarda de `!cepNumero.trim()`). */
export const numeroPreenchido = (n) => !!(n && String(n).trim());

/* Resposta do ViaCEP é um acerto? (mesma guarda de `if (d.erro)`). */
export const respostaCepOk = (d) => !!(d && !d.erro);

/* Coordenada finita dentro dos limites geográficos globais. Preparado para o endurecimento/evolução;
   não ligado aos fluxos atuais (ver cabeçalho). */
export const coordFinita = (n) => typeof n === 'number' && Number.isFinite(n);
export const coordenadasValidas = (lat, lng) =>
  coordFinita(lat) && coordFinita(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

/* REF-ADDRESS-02 · Onda 2 — validadores novos, ainda NÃO ligados a nenhum fluxo (mesma cautela do
   cabeçalho: preparo para as Ondas 5/6 religarem número/complemento/referência e o waterfall de
   geocoding). Puros, sem IO. */

/* confidence: mesmo conjunto do CHECK addresses_confidence_check (migration Onda 1; escopo enxuto
   REF-ADDRESS-AUTOCOMPLETE-01 2026-08-17 — 'approximate' virou 'unknown', ver addressFormat.js) —
   espelha a regra do banco no cliente para dar feedback antes do round-trip, nunca a substitui (o banco
   continua sendo a fonte de verdade). null/undefined é válido (dado legado/ainda não classificado). */
const CONFIDENCE_VALORES = ['exact', 'street_level', 'unknown'];
export const confidenceValida = (c) => c == null || CONFIDENCE_VALORES.includes(c);

/* Endereço pronto para entrega (ADR REF-ADDRESS-02 §4.1/§7): número é sempre obrigatório; coordenadas só
   viram obrigatórias quando o provedor afirma confidence='exact' — é exatamente a distinção que faltava
   no achado do ADR §0.2 (Nominatim descartava o número em silêncio num match a nível de rua). Com
   confidence 'street_level'/'unknown'/ausente, não exige coordenadas (o mapa/GPS ainda não é
   obrigatório em todos os fluxos hoje). */
export const enderecoValidoParaEntrega = (endereco) => {
  if (!endereco || !endereco.label) return false;
  if (!numeroPreenchido(endereco.numero)) return false;
  if (endereco.confidence === 'exact' && !coordenadasValidas(endereco.lat, endereco.lng)) return false;
  return true;
};
