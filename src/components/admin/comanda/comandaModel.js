/* components/admin/comanda/comandaModel.js — REF-ORDER-01 · Parte 1 (Comanda profissional).
   DOMINIO PURO da comanda: transforma o SNAPSHOT de um pedido (orders + order_items + customers)
   no view-model estruturado que a cozinha lê. Sem React, sem IO, sem DOM — roda em Node (golden test).
   Fonte de verdade: o que ESTA persistido no pedido. NUNCA fabrica dado que o checkout nao gravou
   (troco, taxa de entrega, tamanho como campo proprio, split proteina/acompanhamento) — ver ADR.

   REF-COMANDA-ENDERECO-01: o bloco de endereco agora prefere o endereco ESTRUTURADO (orders.endereco_id
   -> addresses, religado na REF-ADDRESS-02 · Onda 6) quando o pedido tem esse vinculo — e a unica fonte
   que sabe mostrar complemento/referencia, que o texto livre em orders.address nunca carrega de forma
   confiavel. Pedido sem vinculo (todo o historico anterior a Onda 6, ou qualquer falha no fetch) cai no
   texto livre de sempre, sem nenhuma mudanca de comportamento — nunca soma as duas fontes na mesma
   comanda (evitaria duplicar rua/numero/bairro).

   Importa so utils/format (folha pura). Contrato de retorno estavel (buildComanda -> objeto sempre
   preenchido; campos ausentes viram null/[] — nunca undefined), para comandaHtml/testes nao precisarem
   de guardas defensivas. */
import { fmt, fmtDataHoraLoja } from '../../../utils/format.js';
import { textoTempoEntrega } from '../../../services/delivery/deliveryEtaFormat.js';

/* Rotulo de exibicao por GRUPO de adicional (a taxonomia crua vive em utils/addons.js; aqui e so copy).
   ESCALAVEL: grupo novo cai no fallback 'Adicionais' e aparece sem alteracao de codigo — se quiser rotulo
   dedicado, basta uma linha aqui. Prefere-se o subgrupo_label do proprio adicional quando existir. */
const GRUPO_LABEL = {
  acai: 'Complementos',
  marmita: 'Adicionais',
  bebida: 'Bebidas',
  simples: 'Adicionais',
  premium: 'Adicionais premium',
  frutas_premium: 'Frutas premium',
  chocolates: 'Chocolates',
};
const labelDoAdicional = (ad) =>
  (ad && typeof ad.subgrupo_label === 'string' && ad.subgrupo_label.trim())
    ? ad.subgrupo_label.trim()
    : (GRUPO_LABEL[ad?.grupo] || 'Adicionais');

const nomeAdicional = (ad) => (ad && (ad.nome || ad.name)) ? String(ad.nome || ad.name).trim() : '';

/* Agrupa os adicionais do item por rotulo, PRESERVANDO a ordem de 1a aparicao (grupo e item).
   Entrada tolerante: array vazio/ausente -> []. Cada saida = { label, itens:[nome,...] }. */
export function agruparAdicionais(adicionais) {
  const lista = Array.isArray(adicionais) ? adicionais : [];
  const ordem = [];
  const mapa = new Map();
  for (const ad of lista) {
    const nome = nomeAdicional(ad);
    if (!nome) continue;
    const label = labelDoAdicional(ad);
    if (!mapa.has(label)) { mapa.set(label, []); ordem.push(label); }
    mapa.get(label).push(nome);
  }
  return ordem.map((label) => ({ label, itens: mapa.get(label) }));
}

/* Deteccao de TIPO — sinal deterministico gravado pelo checkout: retirada persiste
   `address = "Retirada na loja — ..."` (CheckoutPage), entrega persiste o label do cliente. */
const RE_RETIRADA = /retirada\s+na\s+loja/i;
export const tipoDoPedido = (order) => RE_RETIRADA.test(String(order?.address || '')) ? 'retirada' : 'entrega';

/* Pista de "kind" do item — SO para tag/rotulo visual (a categoria nao vive no snapshot do item).
   Heuristica honesta sobre o nome; nunca inventa proteina/acompanhamento que o dado nao tem. */
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function kindDoItem(nome) {
  const n = semAcento(nome);
  if (n.includes('combo')) return 'combo';
  if (n.includes('marmita')) return 'marmita';
  if (n.includes('acai') || n.includes('copo') || n.includes('batidinha')) return 'acai';
  return 'item';
}

/* Endereco de ENTREGA: o pedido guarda um label unico (string), nao campos estruturados.
   Apresentamos honestamente: quebramos por virgula em linhas legiveis (sem inventar rua/numero/bairro). */
function enderecoEmLinhas(address) {
  const raw = String(address || '').trim();
  if (!raw) return null;
  const linhas = raw.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
  return linhas.length ? linhas : [raw];
}

/* REF-COMANDA-ENDERECO-01: endereco ESTRUTURADO (orders.endereco_id -> addresses, religado na
   REF-ADDRESS-02 · Onda 6). Quando existe, SUBSTITUI enderecoEmLinhas (nunca soma às linhas do texto
   livre — evita duplicar rua/numero/bairro, que o texto já mostra) e é a ÚNICA fonte capaz de exibir
   complemento/referência, que o texto livre nunca carrega de forma confiável (nenhuma das 3 abas do
   checkout inclui "referência" no rótulo; "complemento" só entra no texto pela aba CEP). Cada linha só
   aparece se o campo existir — nunca fabrica "Complemento:" ou "Ponto de referência:" vazios. */
function enderecoEstruturadoEmLinhas(e) {
  if (!e) return null;
  const nv = (v) => (v != null && String(v).trim()) ? String(v).trim() : '';
  const linhas = [];
  const ruaNumero = [nv(e.rua), nv(e.numero)].filter(Boolean).join(', ');
  if (ruaNumero) linhas.push(ruaNumero);
  if (nv(e.complemento)) linhas.push(nv(e.complemento));
  const bairroCidade = [nv(e.bairro), [nv(e.cidade), nv(e.estado)].filter(Boolean).join(' - ')].filter(Boolean).join(' — ');
  if (bairroCidade) linhas.push(bairroCidade);
  if (nv(e.cep)) linhas.push('CEP ' + nv(e.cep));
  if (nv(e.referencia)) linhas.push('Ponto de referência: ' + nv(e.referencia));
  return linhas.length ? linhas : null;
}

const PAGAMENTO_LABEL = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_debito: 'Cartão (Débito)',
  cartao_credito: 'Cartão (Crédito)',
};

const numeroFormatado = (numero, order) => {
  if (numero != null && numero !== '') return '#' + String(numero).replace(/^#/, '');
  const id = String(order?.id || '');
  return id ? '#' + id.slice(-5).toUpperCase() : '#—';
};

/* REF-CHECKOUT-03: "numero" (acima) e "refCurta" (abaixo) sao derivados do UUID — otimos p/ a cozinha
   cruzar referencia interna, pessimos p/ o CLIENTE ler ("#604C0", "#F5DDB1E0" parecem hash, nao um
   pedido comercial real). O banco NAO tem coluna sequencial (auditado: orders so tem id uuid +
   created_at — checagem read-only, sem alterar schema/persistencia, fora de escopo desta ref).
   numeroCurto = aproximacao honesta: epoch (segundos) do created_at, ultimos 5 digitos — sempre
   NUMERICO, cresce com o tempo (parece "sequencial" numa janela de uso), mas REINICIA o ciclo a cada
   ~27h (100000s) e pode colidir entre pedidos de dias diferentes na mesma janela. Gap documentado no
   ADR REF-CHECKOUT-03 — trabalho futuro: sequence/coluna propria no banco, se o dono priorizar. So
   usado na mensagem do CLIENTE (comandaTexto contexto:'cliente'); a comanda impressa do Admin continua
   com "numero"/"refCurta" (acima) intocados. */
const numeroCurtoDoPedido = (order) => {
  const t = order?.created_at ? new Date(order.created_at).getTime() : NaN;
  if (!Number.isFinite(t)) return '—';
  const epochSec = Math.floor(t / 1000);
  return String(((epochSec % 100000) + 100000) % 100000).padStart(5, '0');
};

/* Ref curta do cliente = MESMA derivacao do app "Meus Pedidos" (PedidoCard) e da notificacao WhatsApp:
   8 primeiros hex, sem hifen, maiusculo. Permite a cozinha casar um contato do cliente ("meu pedido #XXXX"). */
export const refCurtaDoPedido = (id) => {
  const hex = String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return hex ? '#' + hex : '';
};

/* ── API principal ────────────────────────────────────────────────────────────────────────
   order  : linha de orders com order_items(...) e customers(name,phone) embutidos (DS.getPedidos).
   opts   : { numero?, totalPedidosCliente?, companyInfo?, enderecoEstruturado?, troco?, deliveryEtaMin? }
            (o painel passa o mesmo numero que exibe na tabela; companyInfo vem de useCompanyInfo() em
            ComandaModal.jsx — este modulo continua PURO, nunca importa services/company/*,
            REF-COMPANY-02; enderecoEstruturado vem de DS.getPedidoEndereco — REF-COMANDA-ENDERECO-01;
            troco (REF-CHECKOUT-02) — so o CheckoutPage tem esse dado no instante da montagem (nao e
            persistido no banco, ver ADR REF-ORDER-01 §5 — gap honesto). Ausente/null preserva o
            comportamento de sempre (Admin nunca passa troco). deliveryEtaMin (REF-GOLIVE-01) — tempo de
            entrega configurado pelo Admin (useDeliveryEta), repassado por quem chama; ausente cai no
            fallback de textoTempoEntrega (mesmo numero-default de services/delivery/deliveryEta.js). */
export function buildComanda(order, opts = {}) {
  const o = order || {};
  /* nome curto da empresa (fallback 'Encanto' cobre chamadas sem companyInfo, ex.: testes). "DELIVERY"/
     "Delivery" fica fixo no codigo — rotulo de tipo de documento (como tipoLabel), nao parte do nome. */
  const nomeCurto = (opts.companyInfo && opts.companyInfo.nomeCurto) || 'Encanto';
  /* REF-CHECKOUT-03: nome COMERCIAL completo (campo ja administravel pelo dono — useCompanyInfo/
     Central de Configuracao, REF-COMPANY-02/03 — nunca hardcoded aqui) para o cabecalho/rodape da
     mensagem do CLIENTE, que troca "ENCANTO DELIVERY" + "Marmitas • Açaí" (2 linhas, jargao de
     documento interno) por uma unica linha de identificacao comercial. Fallback so cobre chamadas sem
     companyInfo (testes). */
  const nomeComercial = (opts.companyInfo && opts.companyInfo.nomeCompleto) || `${nomeCurto} — Açaí & Marmitas`;
  const itensRaw = Array.isArray(o.order_items) ? o.order_items : [];
  const tipo = tipoDoPedido(o);

  const itens = itensRaw.map((i) => {
    const qty = Number(i?.quantity) || 1;
    const nome = String(i?.nome_produto || i?.nome || 'Item').trim();
    return {
      qty,
      nome,
      kind: kindDoItem(nome),
      grupos: agruparAdicionais(i?.adicionais),
      obs: (i?.observacoes && String(i.observacoes).trim()) || null,
    };
  });

  const subtotal = itensRaw.reduce((acc, i) => {
    const unit = Number(i?.preco_unitario ?? i?.price) || 0;
    return acc + unit * (Number(i?.quantity) || 1);
  }, 0);
  const total = Number(o?.total) || 0;
  const delta = Math.round((total - subtotal) * 100) / 100;   // diferenca REAL entre itens e total cobrado

  const totalPedidosCliente = Number.isFinite(opts.totalPedidosCliente) ? opts.totalPedidosCliente : null;

  return {
    loja: {
      nome:       `${nomeCurto.toUpperCase()} DELIVERY`,
      nomeFooter: `${nomeCurto} Delivery`,
      linha2:     'Marmitas • Açaí',
      nomeComercial,
    },
    tipo,
    tipoLabel: tipo === 'retirada' ? 'RETIRADA' : 'ENTREGA',
    /* REF-CHECKOUT-03: rotulo do cabecalho SOZINHO da mensagem do cliente ("PARA ENTREGA"/"RETIRADA") —
       tipoLabel (acima) continua servindo a comanda impressa do Admin, intocado. */
    tipoLabelCliente: tipo === 'retirada' ? 'RETIRADA' : 'PARA ENTREGA',
    numero: numeroFormatado(opts.numero, o),
    numeroCurto: numeroCurtoDoPedido(o),
    refCurta: refCurtaDoPedido(o?.id),
    criadoEm: fmtDataHoraLoja(o?.created_at),
    previsao: textoTempoEntrega(tipo, opts.deliveryEtaMin),
    previsaoLabel: tipo === 'retirada' ? 'Retirada prevista' : 'Entrega prevista',
    itens,
    cliente: {
      nome: (o?.customers?.name && String(o.customers.name).trim()) || '—',
      telefone: (o?.customers?.phone && String(o.customers.phone).trim()) || '—',
      totalPedidos: totalPedidosCliente,
    },
    /* REF-COMANDA-ENDERECO-01: estruturado (opts.enderecoEstruturado) vence quando existe — texto
       livre é só o fallback (pedido sem vínculo: legado, ou fetch ainda não resolvido). */
    endereco: tipo === 'retirada' ? null : { linhas: enderecoEstruturadoEmLinhas(opts.enderecoEstruturado) || enderecoEmLinhas(o?.address) || [] },
    pagamento: {
      forma: PAGAMENTO_LABEL[o?.payment_method] || (o?.payment_method ? String(o.payment_method) : '—'),
      /* REF-CHECKOUT-02: troco so existe quando o chamador passa opts.troco (CheckoutPage, no instante
         da montagem — nunca persistido, ver ADR REF-ORDER-01 §5). Admin nao passa -> continua null. */
      troco: (opts.troco && String(opts.troco).trim()) || null,
    },
    observacoes: (o?.observacoes && String(o.observacoes).trim()) || null,
    totais: {
      subtotal,
      subtotalFmt: fmt(subtotal),
      delta,
      deltaFmt: fmt(Math.abs(delta)),
      deltaLabel: delta > 0 ? 'Taxa de entrega / ajuste' : 'Desconto',
      mostrarAjuste: Math.abs(delta) >= 0.01,
      total,
      totalFmt: fmt(total),
    },
    rodape: 'Obrigado pela preferência!',
  };
}
