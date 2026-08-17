/* address/utils/addressFormat.js — REF-ADDRESS-01.
   Normalização e formatação de endereço (lógica pura, sem React/IO). FONTE ÚNICA da formatação: antes
   cada handler do AddressModal montava as strings à mão, com variações sutis entre si. Aqui cada variação
   vira uma função nomeada que reproduz EXATAMENTE a saída do call-site original (comportamento inalterado);
   as diferenças herdadas (ex.: `suburb` vs `suburb||neighbourhood`, fallbacks extras em `pick`) são
   preservadas de propósito e documentadas — candidatas a unificação futura, não alteradas agora. */

/* [road, house_number] — base de várias exibições. */
function ruaNumero(a = {}) { return [a.road, a.house_number].filter(Boolean).join(', '); }

/* REF-ADDRESS-02 · Onda 3 — infere o nível de confiança de um item bruto no shape Nominatim
   ({address:{road,house_number,...}}), a partir só do que o provedor efetivamente devolveu. É a
   distinção provada ao vivo no ADR §0.2: "Rua Amazonas 533" casava a rua mas descartava o número em
   silêncio — um match a nível de rua NÃO é o mesmo que um match exato, mesmo quando o provedor "responde
   algo". Provider-agnóstico (usado pelos 3 adapters do waterfall: Mapbox/Nominatim/Photon).

   REF-ADDRESS-AUTOCOMPLETE-01 (2026-08-17): 'approximate' virou 'unknown' — mesmo escopo enxuto de
   confidence aprovado pelo dono (exact/street_level/unknown). Não virou neighborhood_level/city_level:
   enderecoPlausivel.js já exige address.road pra qualquer resultado de BUSCA sobreviver ao filtro (a
   mesma condição que já produz exact/street_level aqui), então esses 2 níveis mais amplos nunca seriam
   alcançados pelo fluxo de sugestões como está hoje — ficariam inertes no schema. 'unknown' resolve o
   caso real que motivou a mudança: GPS/mapa (que não passa por enderecoPlausivel, usa reverso() direto)
   hoje deixava confidence sem classificar quando o provedor não confirma nem rua nem número. */
export function inferirConfidence(item) {
  const addr = (item && item.address) || {};
  if (addr.house_number) return 'exact';
  if (addr.road) return 'street_level';
  return 'unknown';
}

/* Normaliza o `address` do Nominatim para o shape canônico do pedido {rua,numero,bairro,cidade,estado,cep}.
   `completa:true` (usado em pick) inclui os fallbacks extras (quarter/municipality) do original; o GPS
   usa a variante enxuta.
   REF-SAAS-01 · Onda 6.3: `cidadePadrao`/`estadoPadrao` (opcionais, default '') substituem os antigos
   fallbacks fixos 'Timbó'/'SC' — o chamador informa a cidade/estado da loja resolvida (company_info),
   nunca mais um valor fixo de código. O fallback do provedor (city/town/state ausentes) é comum, não
   raro — 2 dos 3 providers do waterfall deixam esses campos vazios com frequência — por isso o valor
   default sem bias é '' (honesto: "não sabemos"), nunca mais um dado incorreto com aparência de certo. */
export function normalizarEndereco(a = {}, { completa = false, cidadePadrao = '', estadoPadrao = '' } = {}) {
  return {
    rua: a.road || '',
    numero: a.house_number || '',
    bairro: completa ? (a.suburb || a.neighbourhood || a.quarter || '') : (a.suburb || a.neighbourhood || ''),
    cidade: completa ? (a.city || a.town || a.municipality || cidadePadrao) : (a.city || a.town || cidadePadrao),
    estado: a.state || estadoPadrao,
    cep: a.postcode || '',
  };
}

/* Chave de dedupe de sugestão (road+house_number) — regra única usada pelo provedor de busca. */
export function chaveDedupe(s) { const a = s.address || {}; return (a.road || '') + ',' + (a.house_number || ''); }

/* ── SUGESTÕES (lista da aba Buscar) — idêntico ao render inline original ── */
export function sugestaoMain(s) { const a = s.address || {}; return ruaNumero(a) || s.display_name.split(',')[0]; }
/* REF-ADDRESS-AUTOCOMPLETE-01 (2026-08-17): cidade/estado juntos ("Timbó/Santa Catarina") — achado da
   auditoria de rua/cidade homônima ("Timbó" existe em SC/PE/SP/BA): sem o estado, 2 sugestões de mesmo
   nome de cidade ficavam indistinguíveis na lista, mesmo o dado já chegando certo no shape canônico. */
export function sugestaoSub(s) {
  const a = s.address || {};
  const cidadeEstado = [a.city || a.town, a.state].filter(Boolean).join('/');
  return [a.suburb || a.neighbourhood, cidadeEstado, a.postcode ? 'CEP ' + a.postcode : ''].filter(Boolean).join(' · ');
}

/* pick(s): rótulo curto do endereço escolhido (recebe o shape já normalizado + a sugestão p/ fallback). */
export function curtaSugestao(norm, s) {
  return [norm.rua + (norm.numero ? ', ' + norm.numero : ''), norm.bairro].filter(Boolean).join(' — ')
    || s.display_name.split(',').slice(0, 2).join(',').trim();
}

/* useGPS: rótulo curto a partir da resposta reversa (com fallback para o display_name). */
export function curtaGps(a = {}, d = {}) { return ruaNumero(a) || d.display_name?.split(',')[0] || ''; }

/* confirmCEP: rótulo curto a partir do ViaCEP + número + complemento. */
export function curtaCep(cepData, numero, complemento) {
  return `${cepData.logradouro}, ${String(numero).trim()}${complemento ? ' ' + complemento : ''} — ${cepData.bairro}`;
}

/* Reverse-geocode do MAPA (dragend/click): [road, house_number, suburb||neighbourhood, city||town]. */
export function linhaReversaMapa(a = {}) {
  return [a.road, a.house_number, a.suburb || a.neighbourhood, a.city || a.town].filter(Boolean).join(', ');
}

/* confirmMap: [road, house_number, suburb, city||town] — só `suburb` (preserva a diferença do original). */
export function linhaConfirmarMapa(a = {}) {
  return [a.road, a.house_number, a.suburb, a.city || a.town].filter(Boolean).join(', ');
}
