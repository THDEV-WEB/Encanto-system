/* tests/comanda.golden.mjs — REF-ORDER-01 · Parte 1.  node tests/comanda.golden.mjs (npm run test:comanda).
   Congela o dominio PURO da comanda: buildComanda (view-model) + comandaHTML (documento termico).
   Cobre: deteccao entrega/retirada pelo endereco persistido, agrupamento de adicionais por grupo/subgrupo
   preservando ordem, subtotal/total/delta, ausencia de bloco de endereco na retirada, tag COMBO, escape
   de HTML. Puro/Node-safe (comandaModel importa so utils/format, tambem puro). */
import assert from 'node:assert/strict';
import { buildComanda, agruparAdicionais, tipoDoPedido, refCurtaDoPedido } from '../src/components/admin/comanda/comandaModel.js';
import { comandaHTML } from '../src/components/admin/comanda/comandaHtml.js';

let fail = 0;
const check = (m, fn) => { try { fn(); console.error('  ok ' + m); } catch (e) { fail++; console.error('  x  ' + m + ' — ' + (e?.message ?? e)); } };

const pedidoEntrega = {
  id: '2f9c1a7b-1111-2222-3333-abcdeffedcba',
  total: 47.5, status: 'preparo', payment_method: 'pix',
  address: 'Rua das Flores, 123, Centro, Timbó', observacoes: 'Sem cebola',
  created_at: '2026-07-20 12:30:00', customer_id: 'cust-1',
  customers: { name: 'Maria Souza', phone: '(38) 99220-3620' },
  order_items: [
    { id: 'i1', nome_produto: 'Marmita G', quantity: 1, preco_unitario: 25,
      adicionais: [{ nome: 'Carne Extra', grupo: 'marmita' }, { nome: 'Ovo', grupo: 'marmita' }], observacoes: 'bem passada' },
    { id: 'i2', nome_produto: 'Açaí 500ml', quantity: 1, preco_unitario: 22.5,
      adicionais: [{ nome: 'Nutella', grupo: 'acai', subgrupo_label: 'Adicionais Premium' }, { nome: 'Banana', grupo: 'acai' }], observacoes: null },
  ],
};

const pedidoRetirada = {
  id: 'aabbccddee', total: 20, status: 'pronto', payment_method: 'dinheiro',
  address: 'Retirada na loja — Rua João Schley, 77 Casa 02', observacoes: null,
  created_at: '2026-07-20 18:00:00', customer_id: 'cust-2',
  customers: { name: 'João', phone: '38988887777' },
  order_items: [{ id: 'r1', nome_produto: 'Combo Casal', quantity: 1, preco_unitario: 20, adicionais: [], observacoes: null }],
};

/* ── deteccao de tipo (sinal deterministico do checkout) ── */
check('tipoDoPedido: entrega (endereco do cliente)', () => assert.equal(tipoDoPedido(pedidoEntrega), 'entrega'));
check('tipoDoPedido: retirada ("Retirada na loja — ...")', () => assert.equal(tipoDoPedido(pedidoRetirada), 'retirada'));

/* ── agrupamento de adicionais: subgrupo_label vence, grupo mapeado, ORDEM preservada ── */
check('agruparAdicionais separa "Adicionais Premium" de "Complementos" na ordem', () => {
  assert.deepEqual(
    agruparAdicionais(pedidoEntrega.order_items[1].adicionais),
    [{ label: 'Adicionais Premium', itens: ['Nutella'] }, { label: 'Complementos', itens: ['Banana'] }],
  );
});
check('agruparAdicionais agrupa marmita sob "Adicionais"', () => {
  assert.deepEqual(
    agruparAdicionais(pedidoEntrega.order_items[0].adicionais),
    [{ label: 'Adicionais', itens: ['Carne Extra', 'Ovo'] }],
  );
});
check('agruparAdicionais tolera vazio/ausente', () => {
  assert.deepEqual(agruparAdicionais([]), []);
  assert.deepEqual(agruparAdicionais(undefined), []);
});

/* ── view-model completo ── */
const vmE = buildComanda(pedidoEntrega, { numero: 42, totalPedidosCliente: 7 });
check('vm entrega: tipo/label/numero/cliente/endereco', () => {
  assert.equal(vmE.tipo, 'entrega');
  assert.equal(vmE.tipoLabel, 'ENTREGA');
  assert.equal(vmE.numero, '#42');
  assert.equal(vmE.cliente.nome, 'Maria Souza');
  assert.equal(vmE.cliente.totalPedidos, 7);
  assert.deepEqual(vmE.endereco.linhas, ['Rua das Flores', '123', 'Centro', 'Timbó']);
  assert.equal(vmE.pagamento.forma, 'PIX');
  assert.equal(vmE.pagamento.troco, null);   // gap honesto: troco nao e persistido
});
check('refCurta = 8 primeiros hex maiusculos (casa app do cliente + WhatsApp)', () => {
  assert.equal(refCurtaDoPedido('2f9c1a7b-1111-2222-3333-abcdeffedcba'), '#2F9C1A7B');
  assert.equal(vmE.refCurta, '#2F9C1A7B');
  assert.ok(comandaHTML(vmE).includes('Ref. cliente: #2F9C1A7B'));
});
check('vm entrega: subtotal == total => sem linha de ajuste', () => {
  assert.equal(vmE.totais.subtotal, 47.5);
  assert.equal(vmE.totais.total, 47.5);
  assert.equal(vmE.totais.mostrarAjuste, false);
});
check('vm: delta (total != subtotal) vira linha de ajuste com rotulo por sinal', () => {
  const comTaxa = buildComanda({ ...pedidoEntrega, total: 50 }, { numero: 1 });
  assert.equal(comTaxa.totais.mostrarAjuste, true);
  assert.equal(comTaxa.totais.deltaLabel, 'Taxa de entrega / ajuste');
  const comDesc = buildComanda({ ...pedidoEntrega, total: 45 }, { numero: 1 });
  assert.equal(comDesc.totais.deltaLabel, 'Desconto');
});

const vmR = buildComanda(pedidoRetirada, { numero: 8 });
check('vm retirada: sem endereco, item COMBO, totalPedidos null quando ausente', () => {
  assert.equal(vmR.tipoLabel, 'RETIRADA');
  assert.equal(vmR.endereco, null);
  assert.equal(vmR.itens[0].kind, 'combo');
  assert.equal(vmR.cliente.totalPedidos, null);
});

/* ── HTML termico ── */
const htmlE = comandaHTML(vmE);
check('HTML entrega: cabecalho, tipo, itens, obs, subtotal', () => {
  assert.ok(htmlE.includes('ENCANTO DELIVERY'));
  assert.ok(htmlE.includes('ENTREGA'));
  assert.ok(htmlE.includes('Marmita G'));
  assert.ok(htmlE.includes('Nutella'));
  assert.ok(htmlE.includes('Adicionais Premium'));
  assert.ok(htmlE.includes('OBS: bem passada'));
  assert.ok(htmlE.includes('TOTAL'));
  assert.ok(htmlE.includes('Pedidos realizados: 7'));
});
const htmlR = comandaHTML(vmR);
check('HTML retirada: RETIRADA, tag COMBO, sem secao ENDEREÇO', () => {
  assert.ok(htmlR.includes('RETIRADA'));
  assert.ok(htmlR.includes('COMBO'));
  assert.ok(!htmlR.includes('ENDEREÇO'));
});
check('HTML escapa conteudo perigoso (XSS-safe)', () => {
  const vmX = buildComanda({ ...pedidoRetirada, order_items: [{ id: 'x', nome_produto: 'A<b>&"x', quantity: 1, preco_unitario: 1, adicionais: [] }] }, {});
  const h = comandaHTML(vmX);
  assert.ok(h.includes('A&lt;b&gt;&amp;&quot;x'));
  assert.ok(!h.includes('A<b>&"x'));
});

console.log(fail === 0 ? '\nOK comanda.golden — view-model + HTML termico estaveis' : `\nFALHA comanda.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
