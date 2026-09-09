/* pagamento/services/mercadoPagoSdk.js — REF-PAGAMENTO-01 · Onda 5.
   Ciclo de vida do SDK oficial do Mercado Pago (carregado sob demanda do CDN deles, mesmo padrão de
   address/services/mapService.js carregarLeaflet — CSS/JS de terceiro só entram quando o pagamento
   online é de fato usado, nunca no bundle principal). Sem React (recebe callbacks). */

const SDK_URL = 'https://sdk.mercadopago.com/js/v2';

export function sdkPronto() {
  return typeof window !== 'undefined' && !!window.MercadoPago;
}

/* Garante o SDK disponível e chama `pronto()` quando window.MercadoPago existir. Idempotente: se já
   está carregado, só agenda o callback; senão injeta o script do CDN e chama no onload. Erro de rede
   chama `falhou()` (nunca deixa a Promise/callback pendurado para sempre). */
export function carregarMercadoPagoSdk(pronto, falhou) {
  if (sdkPronto()) { setTimeout(pronto, 0); return; }
  const existente = document.querySelector(`script[src="${SDK_URL}"]`);
  if (existente) {
    existente.addEventListener('load', pronto, { once: true });
    if (falhou) existente.addEventListener('error', falhou, { once: true });
    return;
  }
  const js = document.createElement('script');
  js.src = SDK_URL;
  js.onload = pronto;
  js.onerror = () => { if (falhou) falhou(); };
  document.head.appendChild(js);
}

/* Instancia única do SDK por Public Key (o construtor do MP é síncrono, não precisa de rede além do
   script já carregado). locale pt-BR fixo — mesma loja, mesmo idioma sempre, nenhuma configuração
   nova necessária. */
let instancia = null;
let instanciaPublicKey = null;
export function obterInstanciaMercadoPago(publicKey) {
  if (!sdkPronto() || !publicKey) return null;
  if (instancia && instanciaPublicKey === publicKey) return instancia;
  instancia = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
  instanciaPublicKey = publicKey;
  return instancia;
}
