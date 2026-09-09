/* services/delivery/deliveryFeeRules.js — REF-DELIVERY-FEE-01.
   CAMADA UNICA da regra de negocio da taxa de entrega automatica por distancia: localizar a faixa,
   calcular a taxa, calcular o acrescimo de retorno da maquininha e montar o resumo financeiro do pedido.
   Modulo 100% PURO (sem React/IO/Supabase/Date.now, mesma disciplina de utils/pricing.js) — recebe a
   distancia e a configuracao JA carregados (a camada de IO fica em deliveryFeeConfig.js/
   useDeliveryFeeConfig.js) e devolve numeros crus. TODOS os consumidores (Checkout em tempo real,
   persistencia do pedido, comanda, mensagem WhatsApp) usam ESTE modulo — exigencia da REF-DELIVERY-FEE-01
   de nunca duplicar a regra de negocio.

   Distancia: o haversine mora em address/utils/coordinates.js (dominio Address ja possui lat/lng/
   formatarCoord/CENTRO_PADRAO) — este modulo so CONSOME distanciaKm (numero ou null), nunca recalcula
   geometria.

   FALLBACK (decisao do dono, 2026-08-05): quando a distancia nao pode ser determinada (endereco sem
   coordenadas mesmo apos tentar geocodificar de novo) OU a distancia calculada ultrapassa a maior faixa
   cadastrada, o pedido NUNCA e bloqueado — segue com taxa de entrega R$0,00 e o `status` do resumo avisa a
   UI para mostrar "confirmamos o valor da entrega pelo WhatsApp" (nunca finge um valor que nao foi
   calculado). O acrescimo de maquininha e INDEPENDENTE do estado da taxa por distancia (toggle proprio no
   Admin) — so nao se aplica na retirada (sem motoboy) ou fora das formas de pagamento com cartao.

   REF-DELIVERY-FEE-05 · Onda 2: "adicional de pagamento" (+R$2,00 por padrao) — componente SEPARADO da
   maquininha (coexistem, nunca somados num campo so). Regra comercial aprovada pelo dono (2026-09-04):
   dinheiro/debito/credito pagam o adicional, PIX nunca paga; e SO em modalidade ENTREGA (retirada e
   qualquer "mesa" futura ficam em R$0 — mesmo `retirada` booleano que ja zera taxa/maquininha, ver
   montarResumoFinanceiro abaixo — extensivel por construcao: o CheckoutPage ja passa `semEntregaFisica`
   aqui, nao um `retirada` estrito). Ausencia de config.adicionalPagamento (config antiga, salva antes
   desta onda) trata como {ativo:true, valor:2.00} — mesmo precedente da REF-DELIVERY-FEE-01 original
   ("ja nasce ligado", nunca espera o dono reconfigurar).

   REF-DELIVERY-FEE-05 · Onda 1: tabela comercial OFICIAL fornecida pelo dono (2026-09-04) substitui a
   tabela antiga (era so' um modelo/exemplo, nunca a intencao comercial real — auditoria REF-DELIVERY-
   FEE-05 provou isso com 2 casos reais). A regra comercial NAO termina na maior faixa cadastrada: "depois
   de 7km, cada faixa completa de 1km acrescenta R$2,00", para sempre — nunca mais "fora de alcance"/R$0
   so' porque a tabela editavel do Admin parou de listar faixas (decisao antiga da REF-DELIVERY-FEE-01,
   agora substituida por esta regra explicita). `incrementoAcimaFaixas` (novo campo na config, paralelo a
   `faixas`) e' o R$/km usado por `resolverTaxaPorDistancia` para ESTENDER matematicamente a cobranca
   acima da maior faixa cadastrada — nunca centenas de faixas hardcoded. Ausente -> default 2.00 (mesmo
   precedente "ja nasce ligado").

   PRECISAO/ARREDONDAMENTO (politica determinística, decisao desta onda): a distancia e' arredondada para
   1 CASA DECIMAL (100m) — MESMA granularidade dos limites "de"/"ate" cadastrados (sempre X.0/X.1) — antes
   de QUALQUER comparacao de faixa ou calculo de extrapolacao, tanto aqui (client) quanto em
   _resolve_delivery_fee (servidor, `round(v_dist_km::numeric, 1)`). Isso elimina ambiguidade de ponto
   flutuante exatamente na fronteira (ex.: 20.99999999999 e 21.00000000001 arredondam pro MESMO 21.0,
   entao sempre caem na MESMA faixa) e garante que a MESMA distancia produza SEMPRE a MESMA taxa em client
   e servidor. 100m de margem nao e' uma janela pratica de manipulacao (o cliente nao escolhe a propria
   distancia ate a loja — ela vem do endereco real, nunca de um input livre dele) e o arredondamento e'
   PADRAO (Math.round, nao sempre-pra-baixo), entao nao introduz vies sistematico a favor de ninguem. */

/* Formas de pagamento que exigem o motoboy levar a maquininha fisica (a central de motoboys so cobra o
   retorno nesses casos — dinheiro e troco em especie, PIX e QR code, nenhum dos dois usa o aparelho). */
export const MAQUININHA_METODOS = ['cartao_debito', 'cartao_credito'];

/* Formas de pagamento que acionam o adicional de pagamento na entrega — o OPOSTO do recorte da
   maquininha (aqui dinheiro entra, PIX fica de fora). */
export const ADICIONAL_PAGAMENTO_METODOS = ['dinheiro', 'cartao_debito', 'cartao_credito'];

/* Arredonda para 1 casa decimal (100m) — ver politica de precisao no cabecalho do arquivo. Unica porta de
   entrada de qualquer distancia antes de comparar contra faixas, aqui e em resolverTaxaPorDistancia. */
export function arredondarDistanciaKm(distanciaKm) {
  return Math.round(distanciaKm * 10) / 10;
}

/* Localiza a faixa de MENOR "ate" que seja >= distanciaKm (ja arredondada) — as faixas sao contiguas por
   design (cada "de" comeca logo apos o "ate" anterior, ex. 4.0 -> 4.1 na tabela padrao), entao este
   criterio nunca deixa uma distancia continua cair num buraco de cobertura entre 2 faixas cadastradas.
   null quando a distancia for invalida ou maior que a maior faixa cadastrada (fora de alcance — ver
   resolverTaxaPorDistancia para a extrapolacao matematica acima da maior faixa, REF-DELIVERY-FEE-05 ·
   Onda 1). */
export function localizarFaixa(distanciaKm, faixas) {
  if (!Number.isFinite(distanciaKm) || distanciaKm < 0) return null;
  const dist = arredondarDistanciaKm(distanciaKm);
  const lista = Array.isArray(faixas) ? faixas : [];
  const ordenadas = lista.slice().sort((a, b) => a.ate - b.ate);
  return ordenadas.find((f) => dist <= f.ate) || null;
}

/* REF-DELIVERY-FEE-05 · Onda 1: resolve a taxa de entrega por distancia, estendendo MATEMATICAMENTE a
   cobranca acima da maior faixa cadastrada — "depois de 7km, cada faixa completa de 1km acrescenta
   R$2,00", regra comercial explicita do dono, nunca um limite artificial de "fora de alcance"/R$0 so'
   porque a lista editavel do Admin parou de listar faixas.
   Primeiro tenta localizarFaixa (faixa exata, cadastrada). So' extrapola quando NAO ha faixa exata E a
   distancia excede a maior faixa cadastrada E incrementoAcimaFaixas e' um numero > 0 (ausente/invalido ->
   comportamento antigo preservado, status 'fora_de_alcance'/R$0 -- nunca lanca, nunca bloqueia).
   Formula: kmExtras = ceil(distanciaArredondada - maiorFaixa.ate); valor = maiorFaixa.valor +
   incrementoAcimaFaixas * kmExtras. Confere com os casos de aceitacao do dono (maior faixa 20km/R$40,
   incremento R$2): 20.1km->ceil(0.1)=1->R$42; 21.0km->ceil(1.0)=1->R$42; 21.1km->ceil(1.1)=2->R$44;
   23.0km->ceil(3.0)=3->R$46; 25.0km->ceil(5.0)=5->R$50. */
export function resolverTaxaPorDistancia(distanciaKm, faixas, incrementoAcimaFaixas) {
  const faixa = localizarFaixa(distanciaKm, faixas);
  if (faixa) return { valor: Number(faixa.valor) || 0, faixa, extrapolado: false };

  const incremento = Number(incrementoAcimaFaixas);
  if (!Number.isFinite(distanciaKm) || distanciaKm < 0 || !Number.isFinite(incremento) || incremento <= 0) return null;

  const lista = Array.isArray(faixas) ? faixas : [];
  const maior = lista.reduce((m, f) => (m === null || f.ate > m.ate ? f : m), null);
  if (!maior) return null;

  const dist = arredondarDistanciaKm(distanciaKm);
  if (dist <= maior.ate) return null;   // nao deveria ocorrer (localizarFaixa ja teria achado), defesa em profundidade

  const kmExtras = Math.ceil(dist - maior.ate);
  const valor = (Number(maior.valor) || 0) + incremento * kmExtras;
  return { valor, faixa: null, extrapolado: true };
}

/* Acrescimo de retorno da maquininha — depende SOMENTE da forma de pagamento + do toggle do Admin, nunca
   da distancia/faixa. */
export function calcularMaquininhaFee(paymentMethod, maquininhaConfig) {
  const cfg = maquininhaConfig || {};
  if (!cfg.ativo) return 0;
  if (!MAQUININHA_METODOS.includes(paymentMethod)) return 0;
  return Number(cfg.valor) || 0;
}

/* Adicional de pagamento na entrega — depende da forma de pagamento + do toggle do Admin, IGUAL a
   calcularMaquininhaFee em forma, mas com o recorte de metodos invertido (PIX de fora, dinheiro dentro).
   `retirada` (gate de modalidade) e' decidido pelo CHAMADOR (montarResumoFinanceiro), nunca aqui — esta
   funcao so responde "essa forma de pagamento paga o adicional, supondo que ha entrega fisica?".
   config ausente -> {ativo:true, valor:2.00} (nao {} vazio) — "ja nasce ligado", ver cabecalho do
   arquivo; diferente de calcularMaquininhaFee, cujo precedente historico e' ausencia = desligado.
   REF-DELIVERY-FEE-05 · Onda 4: MUTUAMENTE EXCLUSIVO com maquininhaFee (espelha _resolve_delivery_fee
   SQL) — so' cobra quando a maquininha ja NAO se aplicou a este pedido (maquininhaFee=0). Achado do
   dono em teste ao vivo: as duas ativas ao mesmo tempo cobravam R$4 no cartao (R$2+R$2); agora cartao
   cobra so' R$2 (via maquininha), dinheiro continua cobrando R$2 (via adicional, maquininha nunca
   cobre dinheiro) — nunca R$4. */
export function calcularAdicionalPagamentoFee(paymentMethod, adicionalPagamentoConfig, maquininhaFee = 0) {
  if (Number(maquininhaFee) > 0) return 0;
  const cfg = adicionalPagamentoConfig || { ativo: true, valor: 2.00 };
  if (!cfg.ativo) return 0;
  if (!ADICIONAL_PAGAMENTO_METODOS.includes(paymentMethod)) return 0;
  return Number(cfg.valor) || 0;
}

/* Resumo financeiro do pedido — FONTE UNICA consumida por Checkout (tempo real)/buildOrderArgs
   (persistencia)/buildOrderConfirmationMessage (WhatsApp)/comandaModel (Admin + comanda impressa).
   entrada:
     subtotal      : Number — cart.total (soma dos itens, de utils/pricing.js)
     retirada      : boolean — retirada na loja nunca tem taxa de entrega nem maquininha (sem motoboy)
     distanciaKm   : number|null — null quando nao foi possivel calcular (sem coordenadas do cliente/loja)
     config        : objeto delivery_fee_config { ativo, maquininha:{ativo,valor}, faixas:[{de,ate,valor}] }
     paymentMethod : string — forma de pagamento escolhida no checkout
   saida (sempre preenchida, nunca undefined):
     { subtotal, distanciaKm, faixa, faixaExtrapolada, deliveryFee, maquininhaFee, adicionalPagamentoFee,
       total, status, configuracaoPropria }
     status: 'retirada' | 'desativado' | 'sem_coordenadas' | 'fora_de_alcance' | 'ok'
     faixaExtrapolada: REF-DELIVERY-FEE-05 · Onda 1 -- true quando deliveryFee veio da extensao
       matematica (resolverTaxaPorDistancia) acima da maior faixa cadastrada, nao de uma faixa exata;
       `faixa` fica null nesse caso (nao ha faixa cadastrada correspondente).
     configuracaoPropria: REF-STORE-ONBOARD-02 · Onda 2 -- true quando a loja tem sua PRÓPRIA tabela de
       faixas (config.configuracao_propria, vem do RPC get_delivery_fee_config); false quando o valor
       calculado usa a tabela padrão da plataforma (fallback). Distinto de 'sem_coordenadas'/
       'fora_de_alcance' (que já sinalizam via `status` a falta da distância em si) -- este campo cobre
       especificamente o caso "há distância e faixa, mas a tabela em si não é da loja". Default `true`
       (sem aviso) se `config` não trouxer o campo (compat com chamadores antigos/testes).
     adicionalPagamentoFee: REF-DELIVERY-FEE-05 · Onda 2 -- SEMPRE 0 quando `retirada` (mesmo parametro
       que já zera deliveryFee/maquininhaFee — o chamador (CheckoutPage) já resolve "retirada OU mesa"
       nesse mesmo booleano antes de chamar esta função, então nenhuma mudança adicional é necessária
       aqui para cobrir "mesa" no futuro). Fora da retirada, depende só da forma de pagamento + config
       (calcularAdicionalPagamentoFee) — independe de distância/faixa, igual à maquininha. */
export function montarResumoFinanceiro({ subtotal, retirada, distanciaKm, config, paymentMethod }) {
  const sub = Number(subtotal) || 0;
  const cfg = config || {};
  const configuracaoPropria = cfg.configuracao_propria !== false;

  if (retirada) {
    return { subtotal: sub, distanciaKm: null, faixa: null, faixaExtrapolada: false, deliveryFee: 0, maquininhaFee: 0, adicionalPagamentoFee: 0, total: sub, status: 'retirada', configuracaoPropria };
  }

  const maquininhaFee = calcularMaquininhaFee(paymentMethod, cfg.maquininha);
  const adicionalPagamentoFee = calcularAdicionalPagamentoFee(paymentMethod, cfg.adicionalPagamento, maquininhaFee);
  const acrescimos = maquininhaFee + adicionalPagamentoFee;

  if (!cfg.ativo) {
    return { subtotal: sub, distanciaKm: Number.isFinite(distanciaKm) ? distanciaKm : null, faixa: null, faixaExtrapolada: false, deliveryFee: 0, maquininhaFee, adicionalPagamentoFee, total: sub + acrescimos, status: 'desativado', configuracaoPropria };
  }
  if (!Number.isFinite(distanciaKm)) {
    return { subtotal: sub, distanciaKm: null, faixa: null, faixaExtrapolada: false, deliveryFee: 0, maquininhaFee, adicionalPagamentoFee, total: sub + acrescimos, status: 'sem_coordenadas', configuracaoPropria };
  }

  const resolvido = resolverTaxaPorDistancia(distanciaKm, cfg.faixas, cfg.incrementoAcimaFaixas ?? 2.00);
  if (!resolvido) {
    return { subtotal: sub, distanciaKm, faixa: null, faixaExtrapolada: false, deliveryFee: 0, maquininhaFee, adicionalPagamentoFee, total: sub + acrescimos, status: 'fora_de_alcance', configuracaoPropria };
  }

  const deliveryFee = Number(resolvido.valor) || 0;
  return {
    subtotal: sub, distanciaKm, faixa: resolvido.faixa, faixaExtrapolada: resolvido.extrapolado,
    deliveryFee, maquininhaFee, adicionalPagamentoFee, total: sub + deliveryFee + acrescimos, status: 'ok', configuracaoPropria,
  };
}
