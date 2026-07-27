/* address/utils/addressModel.js — REF-CHECKOUT-ADDRESS-01 (+ REF-ADDRESS-02 · Onda 2).
   Modelo canonico UNICO do endereco de entrega (puro, sem React/IO). E o objeto que Header, Checkout,
   Pedido e Persistencia consomem — nunca mais strings/estados paralelos. `montarEndereco` normaliza o
   par (label, meta) que o AddressModal emite (onSelect) para este shape; a base fica pronta para evolucao
   (multiplos enderecos/principal/area de entrega/distancia/geofencing) sem implementa-las agora.

   REF-ADDRESS-02 · Onda 2: acrescenta referencia/placeId/provider/confidence (campos que a migration da
   Onda 1 ja persiste em `addresses`, mas que nenhum provedor ainda preenche — chegam '' /null ate as
   Ondas 3/5 religarem o waterfall de geocoding e o formulario). Aditivo: nenhum call-site existente
   passa esses campos em `meta` hoje, entao o shape so cresce com defaults — zero mudanca de comportamento
   para quem ja consome so `.label`/`.rua`/etc. */

/* Endereco vazio = ausencia de endereco (nunca um objeto meia-boca). */
export const ENDERECO_VAZIO = null;

/* Ha um endereco valido (com rotulo)? Fonte unica dessa checagem. */
export const enderecoPreenchido = (e) => !!(e && e.label);

/* (label, meta) -> objeto canonico. label e a string exibida/persistida/enviada ao pedido; os campos
   estruturados (rua/numero/bairro/cidade/estado/cep/complemento/lat/lng/referencia/placeId/provider/
   confidence) vem do provedor (ViaCEP/Nominatim/waterfall futuro) e ficam prontos para uso futuro.
   Retorna null se nao houver label. */
export function montarEndereco(label, meta = {}) {
  if (!label) return ENDERECO_VAZIO;
  const m = meta || {};
  return {
    label,
    rua: m.rua || '',
    numero: m.numero || '',
    bairro: m.bairro || '',
    cidade: m.cidade || '',
    estado: m.estado || '',
    cep: m.cep || '',
    complemento: m.complemento || '',
    lat: m.lat ?? null,
    lng: m.lng ?? null,
    full: m.full || '',
    referencia: m.referencia || '',
    placeId: m.placeId || '',
    provider: m.provider || '',
    confidence: m.confidence || null,
  };
}
