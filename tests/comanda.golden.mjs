/* tests/comanda.golden.mjs — REF-ORDER-01 · Parte 1.  node tests/comanda.golden.mjs (npm run test:comanda).
   Congela o dominio PURO da comanda: buildComanda (view-model) + comandaHTML (documento termico).
   Cobre: deteccao entrega/retirada pelo endereco persistido, agrupamento de adicionais por grupo/subgrupo
   preservando ordem, subtotal/total/delta, ausencia de bloco de endereco na retirada, tag COMBO, escape
   de HTML. Puro/Node-safe (comandaModel importa so utils/format, tambem puro). */
import assert from 'node:assert/strict';
import { buildComanda, agruparAdicionais, tipoDoPedido, refCurtaDoPedido } from '../src/components/admin/comanda/comandaModel.js';
import { comandaHTML } from '../src/components/admin/comanda/comandaHtml.js';
import { comandaTexto } from '../src/components/admin/comanda/comandaTexto.js';

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

/* ── REF-COMANDA-ENDERECO-01: endereco ESTRUTURADO vence o texto livre, quando existe ── */
check('vm entrega + enderecoEstruturado completo: complemento e referencia aparecem, texto livre é ignorado', () => {
  const vm = buildComanda(pedidoEntrega, {
    numero: 42,
    enderecoEstruturado: {
      rua: 'Rua das Flores', numero: '123', complemento: 'Apto 4, Bloco B',
      bairro: 'Centro', cidade: 'Timbó', estado: 'SC', cep: '89120-000',
      referencia: 'Perto do mercado',
    },
  });
  assert.deepEqual(vm.endereco.linhas, [
    'Rua das Flores, 123',
    'Apto 4, Bloco B',
    'Centro — Timbó - SC',
    'CEP 89120-000',
    'Ponto de referência: Perto do mercado',
  ]);
});
check('vm entrega + enderecoEstruturado SEM complemento: linha de complemento não aparece', () => {
  const vm = buildComanda(pedidoEntrega, {
    enderecoEstruturado: { rua: 'Rua X', numero: '10', bairro: 'B', cidade: 'C', estado: 'SC', referencia: 'Ref' },
  });
  assert.ok(!vm.endereco.linhas.some((l) => l.includes('Bloco')));
  assert.deepEqual(vm.endereco.linhas, ['Rua X, 10', 'B — C - SC', 'Ponto de referência: Ref']);
});
check('vm entrega + enderecoEstruturado SEM referencia: linha "Ponto de referência" não aparece', () => {
  const vm = buildComanda(pedidoEntrega, {
    enderecoEstruturado: { rua: 'Rua X', numero: '10', bairro: 'B', cidade: 'C', estado: 'SC' },
  });
  assert.ok(!vm.endereco.linhas.some((l) => l.startsWith('Ponto de referência')));
});
check('vm entrega + enderecoEstruturado TOTALMENTE vazio: cai no texto livre (nunca fabrica linha vazia)', () => {
  const vm = buildComanda(pedidoEntrega, { enderecoEstruturado: { rua: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '', cep: '', referencia: '' } });
  assert.deepEqual(vm.endereco.linhas, ['Rua das Flores', '123', 'Centro', 'Timbó']);   // fallback = golden original
});
check('vm entrega SEM enderecoEstruturado (opts ausente): comportamento 100% igual ao anterior (compat. pedido legado)', () => {
  const vm = buildComanda(pedidoEntrega, { numero: 42 });
  assert.deepEqual(vm.endereco.linhas, ['Rua das Flores', '123', 'Centro', 'Timbó']);
});
check('vm retirada + enderecoEstruturado presente: ainda assim sem endereco (retirada nunca mostra endereco do cliente)', () => {
  const vm = buildComanda(pedidoRetirada, { enderecoEstruturado: { rua: 'Rua X', numero: '1', referencia: 'Ref' } });
  assert.equal(vm.endereco, null);
});
check('HTML/texto: complemento e referencia aparecem na comanda impressa quando o vinculo existe', () => {
  const vm = buildComanda(pedidoEntrega, {
    enderecoEstruturado: { rua: 'Rua das Flores', numero: '123', complemento: 'Apto 4', bairro: 'Centro', referencia: 'Perto do mercado' },
  });
  const html = comandaHTML(vm);
  const texto = comandaTexto(vm);
  assert.ok(html.includes('Apto 4'));
  assert.ok(html.includes('Ponto de referência: Perto do mercado'));
  assert.ok(texto.includes('Apto 4'));
  assert.ok(texto.includes('Ponto de referência: Perto do mercado'));
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

/* ── texto simples (Copiar / WhatsApp) — REF-REGRESSION-01 · P5 ── */
const textoE = comandaTexto(vmE);
check('texto entrega: cabecalho, tipo, itens, obs, cliente, total — sem HTML nenhum', () => {
  assert.ok(textoE.includes('ENCANTO DELIVERY'));
  assert.ok(textoE.includes('ENTREGA'));
  assert.ok(textoE.includes('Marmita G'));
  assert.ok(textoE.includes('Nutella'));
  assert.ok(textoE.includes('Adicionais Premium'));
  assert.ok(textoE.includes('OBS: bem passada'));
  assert.ok(textoE.includes('Maria Souza'));
  assert.ok(textoE.includes('Pedidos realizados: 7'));
  assert.ok(textoE.includes('TOTAL'));
  assert.ok(!/<[a-z]/i.test(textoE), 'texto plano não deve conter marcação HTML');
});
const textoR = comandaTexto(vmR);
check('texto retirada: RETIRADA, tag COMBO, sem secao ENDEREÇO', () => {
  assert.ok(textoR.includes('RETIRADA'));
  assert.ok(textoR.includes('[COMBO]'));
  assert.ok(!textoR.includes('ENDEREÇO'));
});
check('texto: nunca fabrica HTML-escape (conteudo cru, plano)', () => {
  const vmX = buildComanda({ ...pedidoRetirada, order_items: [{ id: 'x', nome_produto: 'A<b>&"x', quantity: 1, preco_unitario: 1, adicionais: [] }] }, {});
  const txt = comandaTexto(vmX);
  assert.ok(txt.includes('A<b>&"x'), 'texto plano preserva o nome cru (destino é clipboard/WhatsApp, não HTML)');
});

/* ── REF-COMPANY-02: loja.nome/nomeFooter derivam de opts.companyInfo.nomeCurto (fallback 'Encanto'
   cobre as chamadas acima, sem opts.companyInfo — prova que a fiacao ponta-a-ponta nao e codigo morto). ── */
check('vm com companyInfo custom: cabecalho e rodape derivam do mesmo nomeCurto', () => {
  const vmC = buildComanda(pedidoRetirada, { numero: 1, companyInfo: { nomeCurto: 'Sabor Real' } });
  assert.equal(vmC.loja.nome, 'SABOR REAL DELIVERY');
  assert.equal(vmC.loja.nomeFooter, 'Sabor Real Delivery');
  assert.ok(comandaHTML(vmC).includes('SABOR REAL DELIVERY'));
  assert.ok(comandaHTML(vmC).includes('Sabor Real Delivery'));
  assert.ok(comandaTexto(vmC).includes('Sabor Real Delivery'));
});

/* ── REF-CHECKOUT-02: opts.troco (buildComanda) — Admin nunca passa -> continua null sempre. ── */
check('buildComanda: sem opts.troco -> pagamento.troco null (compat. Admin, igual a sempre)', () => {
  assert.equal(buildComanda(pedidoEntrega, { numero: 42 }).pagamento.troco, null);
});
check('buildComanda: opts.troco presente -> pagamento.troco populado', () => {
  const vm = buildComanda(pedidoEntrega, { numero: 42, troco: 'R$ 50,00' });
  assert.equal(vm.pagamento.troco, 'R$ 50,00');
});
check('buildComanda: opts.troco string vazia/espacos -> null (nunca fabrica)', () => {
  assert.equal(buildComanda(pedidoEntrega, { troco: '' }).pagamento.troco, null);
  assert.equal(buildComanda(pedidoEntrega, { troco: '   ' }).pagamento.troco, null);
});
check('comandaTexto: sem opts (contexto interna implicito) -> comportamento 100% igual ao anterior', () => {
  assert.equal(comandaTexto(vmE), textoE);
  assert.ok(comandaTexto(vmE).includes('COBRAR DO CLIENTE'));
});

/* ── REF-CHECKOUT-03: campos novos e ADITIVOS do view-model (numeroCurto/tipoLabelCliente/
   previsaoLabel/loja.nomeComercial) — nenhum campo existente foi removido/alterado; a comanda
   impressa do Admin (comandaHTML + comandaTextoInterna, testados acima) permanece byte-a-byte igual. ── */
check('buildComanda: numeroCurto e sempre 5 digitos numericos derivados de created_at (nunca hash/UUID)', () => {
  const vm = buildComanda(pedidoEntrega, {});
  assert.match(vm.numeroCurto, /^\d{5}$/);
});
check('buildComanda: numeroCurto e deterministico (mesmo created_at -> mesmo numero)', () => {
  const a = buildComanda(pedidoEntrega, {}).numeroCurto;
  const b = buildComanda(pedidoEntrega, {}).numeroCurto;
  assert.equal(a, b);
});
check('buildComanda: numeroCurto muda com created_at diferente (nao e constante)', () => {
  const a = buildComanda(pedidoEntrega, {}).numeroCurto;
  const b = buildComanda({ ...pedidoEntrega, created_at: '2026-01-01 00:00:00' }, {}).numeroCurto;
  assert.notEqual(a, b);
});
check('buildComanda: tipoLabelCliente = PARA ENTREGA (entrega) / RETIRADA (retirada); tipoLabel do Admin intocado', () => {
  assert.equal(buildComanda(pedidoEntrega, {}).tipoLabelCliente, 'PARA ENTREGA');
  assert.equal(buildComanda(pedidoRetirada, {}).tipoLabelCliente, 'RETIRADA');
  assert.equal(buildComanda(pedidoEntrega, {}).tipoLabel, 'ENTREGA');   // Admin: sem mudanca
});
check('buildComanda: previsaoLabel muda por tipo; previsao (valor) intocada', () => {
  assert.equal(buildComanda(pedidoEntrega, {}).previsaoLabel, 'Entrega prevista');
  assert.equal(buildComanda(pedidoRetirada, {}).previsaoLabel, 'Retirada prevista');
});

/* ── REF-GOLIVE-01 (bloqueador 2): previsao (entrega) deixou de ser "35 a 45 min" fixo — vem do MESMO
   numero configurado pelo Admin (deliveryEtaMin), propagado pelo chamador (CheckoutPage/ComandaModal).
   Retirada continua "cerca de 20 min" (constante de negocio, fora do escopo do REF-DELIVERY-01). ── */
check('buildComanda: previsao (entrega) usa opts.deliveryEtaMin quando informado', () => {
  assert.equal(buildComanda(pedidoEntrega, { deliveryEtaMin: 60 }).previsao, 'até 60 min');
  assert.equal(buildComanda(pedidoEntrega, { deliveryEtaMin: 30 }).previsao, 'até 30 min');
});
check('buildComanda: previsao (entrega) sem deliveryEtaMin cai no fallback (nunca "35 a 45 min" fixo)', () => {
  assert.equal(buildComanda(pedidoEntrega, {}).previsao, 'até 45 min');
});
check('buildComanda: previsao (retirada) e constante de negocio, ignora deliveryEtaMin', () => {
  assert.equal(buildComanda(pedidoRetirada, { deliveryEtaMin: 60 }).previsao, 'cerca de 20 min');
  assert.equal(buildComanda(pedidoRetirada, {}).previsao, 'cerca de 20 min');
});
check('comandaTexto: previsao dinamica aparece na comanda interna e na mensagem do cliente', () => {
  const vm = buildComanda(pedidoEntrega, { numero: 42, deliveryEtaMin: 60 });
  assert.ok(comandaTexto(vm).includes('Previsão: até 60 min'));
  assert.ok(comandaTexto(vm, { contexto: 'cliente' }).includes('Entrega prevista: até 60 min'));
});
check('buildComanda: loja.nomeComercial vem de companyInfo.nomeCompleto quando presente', () => {
  const vm = buildComanda(pedidoEntrega, { companyInfo: { nomeCurto: 'Encanto', nomeCompleto: 'Encanto — Açaí & Marmitas' } });
  assert.equal(vm.loja.nomeComercial, 'Encanto — Açaí & Marmitas');
});
check('buildComanda: loja.nomeComercial tem fallback quando companyInfo ausente (nao quebra testes/chamadas antigas)', () => {
  assert.ok(buildComanda(pedidoEntrega, {}).loja.nomeComercial.includes('Encanto'));
});

/* ── REF-CHECKOUT-03: comandaTexto contexto 'cliente' — layout comercial completo (mock/imagem
   de referencia anexada ao pedido). Reaproveita o MESMO view-model; comandaTextoInterna (testado
   acima) prova que o Admin nao muda uma linha. ── */
check("cliente: cabecalho e SO o tipo (PARA ENTREGA/RETIRADA), sem ENCANTO DELIVERY/Marmitas no topo", () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.ok(txt.startsWith('*PARA ENTREGA*'));
  assert.ok(!txt.includes('ENCANTO DELIVERY'));
  assert.ok(!txt.includes('Marmitas • Açaí'));
});
check('cliente: retirada usa cabecalho RETIRADA', () => {
  const txt = comandaTexto(vmR, { contexto: 'cliente' });
  assert.ok(txt.startsWith('*RETIRADA*'));
});
check('cliente: numero do pedido e "Pedido NNNNN" (5 digitos, sem #/hash/UUID)', () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.match(txt, /\*Pedido \d{5}\*/);
  assert.ok(!txt.includes(vmE.numero));      // nunca o "#XXXXX" do Admin
  assert.ok(!txt.includes(vmE.refCurta));    // nunca a ref curta (hex) do Admin
});
check('cliente: sem "Ref. cliente" (codigo tecnico sem utilidade pro proprio cliente)', () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.ok(!txt.includes('Ref. cliente'));
});
check('cliente: "Cobrar do cliente" MANTIDO (quem le a mensagem e a loja, nao o cliente)', () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.ok(txt.includes('*Cobrar do cliente*'));
});
check('cliente: troco SEMPRE aparece — "Troco para: X" quando informado', () => {
  const vmComTroco = buildComanda(pedidoEntrega, { troco: 'R$ 50,00' });
  const txt = comandaTexto(vmComTroco, { contexto: 'cliente' });
  assert.ok(txt.includes('Troco para: R$ 50,00'));
});
check('cliente: troco SEMPRE aparece — "Troco: Não precisa" quando ausente (nunca omite a linha)', () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.ok(txt.includes('Troco: Não precisa'));
});
check('cliente: ajuste positivo (taxa) NAO aparece (ainda nao calculada automaticamente)', () => {
  const vm = buildComanda({ ...pedidoEntrega, total: 50 }, {});
  const txt = comandaTexto(vm, { contexto: 'cliente' });
  assert.ok(!txt.includes('Taxa de entrega'));
  assert.ok(!/^Taxa/m.test(txt));
});
check('cliente: ajuste negativo (desconto) aparece como "Desconto: X"', () => {
  const vm = buildComanda({ ...pedidoEntrega, total: 45 }, {});
  const txt = comandaTexto(vm, { contexto: 'cliente' });
  assert.ok(txt.includes(`Desconto: ${vm.totais.deltaFmt}`));
});
check("interna: 'Taxa de entrega / ajuste' continua aparecendo (Admin 100% intocado)", () => {
  const vm = buildComanda({ ...pedidoEntrega, total: 50 }, { numero: 1 });
  const txt = comandaTexto(vm);
  assert.ok(txt.includes('Taxa de entrega / ajuste'));
});
check('cliente: endereco estruturado aparece sob "Entrega:" (retirada nunca mostra bloco de endereco)', () => {
  const vm = buildComanda(pedidoEntrega, {
    enderecoEstruturado: { rua: 'Rua Nova', numero: '10', bairro: 'Centro', cidade: 'Timbó', referencia: 'Perto do mercado' },
  });
  const txt = comandaTexto(vm, { contexto: 'cliente' });
  assert.ok(txt.includes('Entrega:'));
  assert.ok(txt.includes('Rua Nova, 10'));
  assert.ok(txt.includes('Ponto de referência: Perto do mercado'));
  const txtRetirada = comandaTexto(vmR, { contexto: 'cliente' });
  assert.ok(!txtRetirada.includes('Entrega:'));
});
check('cliente: rodape e so o nome comercial (sem "Obrigado pela preferencia")', () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.ok(!txt.includes('Obrigado pela preferência'));
  assert.ok(txt.trim().endsWith(vmE.loja.nomeComercial));
});
check('cliente: nunca contem marcacao HTML (texto puro, igual a comandaTextoInterna)', () => {
  const txt = comandaTexto(vmE, { contexto: 'cliente' });
  assert.ok(!/<[a-z]/i.test(txt));
});

console.log(fail === 0 ? '\nOK comanda.golden — view-model + HTML termico + texto simples estaveis' : `\nFALHA comanda.golden — ${fail} caso(s)`);
process.exit(fail ? 1 : 0);
