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
