/* components/admin/comanda/comandaModel.js — REF-ORDER-01 · Parte 1 (Comanda profissional).
   DOMINIO PURO da comanda: transforma o SNAPSHOT de um pedido (orders + order_items + customers)
   no view-model estruturado que a cozinha lê. Sem React, sem IO, sem DOM — roda em Node (golden test).
   Fonte de verdade: o que ESTA persistido no pedido. NUNCA fabrica dado que o checkout nao gravou
   (troco, taxa de entrega, tamanho como campo proprio, split proteina/acompanhamento) — ver ADR.

   Importa so utils/format (folha pura). Contrato de retorno estavel (buildComanda -> objeto sempre
   preenchido; campos ausentes viram null/[] — nunca undefined), para comandaHtml/testes nao precisarem
   de guardas defensivas. */
import { fmt, fmtDataHoraLoja } from '../../../utils/format.js';

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

const PAGAMENTO_LABEL = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_debito: 'Cartão (Débito)',
  cartao_credito: 'Cartão (Crédito)',
};

/* Estimativa de preparo/entrega — constante local (o dado dinamico e dominio da REF-DELIVERY-01;
   aqui usamos a MESMA copy que o cliente ja viu no header, sem acoplar). */
const PREVISAO = { entrega: '35 a 45 min', retirada: 'cerca de 20 min' };

const numeroFormatado = (numero, order) => {
  if (numero != null && numero !== '') return '#' + String(numero).replace(/^#/, '');
  const id = String(order?.id || '');
  return id ? '#' + id.slice(-5).toUpperCase() : '#—';
};

/* Ref curta do cliente = MESMA derivacao do app "Meus Pedidos" (PedidoCard) e da notificacao WhatsApp:
   8 primeiros hex, sem hifen, maiusculo. Permite a cozinha casar um contato do cliente ("meu pedido #XXXX"). */
export const refCurtaDoPedido = (id) => {
  const hex = String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
  return hex ? '#' + hex : '';
};

/* ── API principal ────────────────────────────────────────────────────────────────────────
   order  : linha de orders com order_items(...) e customers(name,phone) embutidos (DS.getPedidos).
   opts   : { numero?, totalPedidosCliente? }  (o painel passa o mesmo numero que exibe na tabela). */
export function buildComanda(order, opts = {}) {
  const o = order || {};
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
    loja: { nome: 'ENCANTO DELIVERY', linha2: 'Marmitas • Açaí' },
    tipo,
    tipoLabel: tipo === 'retirada' ? 'RETIRADA' : 'ENTREGA',
    numero: numeroFormatado(opts.numero, o),
    refCurta: refCurtaDoPedido(o?.id),
    criadoEm: fmtDataHoraLoja(o?.created_at),
    previsao: PREVISAO[tipo],
    itens,
    cliente: {
      nome: (o?.customers?.name && String(o.customers.name).trim()) || '—',
      telefone: (o?.customers?.phone && String(o.customers.phone).trim()) || '—',
      totalPedidos: totalPedidosCliente,
    },
    endereco: tipo === 'retirada' ? null : { linhas: enderecoEmLinhas(o?.address) || [] },
    pagamento: {
      forma: PAGAMENTO_LABEL[o?.payment_method] || (o?.payment_method ? String(o.payment_method) : '—'),
      troco: null,   // GAP: troco nao e persistido pelo checkout (ADR). Nunca fabricar.
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
