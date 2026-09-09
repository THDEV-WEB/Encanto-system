/* tests/deliveryFee.golden.mjs — REF-DELIVERY-FEE-01 (+05 · Ondas 1/2) · roda com:
   node tests/deliveryFee.golden.mjs
   Valida a camada UNICA de regra de negocio da taxa de entrega por distancia (services/delivery/
   deliveryFeeRules.js) + o haversine (address/utils/coordinates.js):
   (A) distanciaKm — pontos iguais, distancia conhecida, coordenadas invalidas
   (B) localizarFaixa — tabela comercial OFICIAL (16 faixas), mudanca entre faixas, fora de alcance
   (B2) arredondarDistanciaKm / resolverTaxaPorDistancia — precisao de 1 casa decimal, extrapolacao
       matematica acima de 20km (REF-DELIVERY-FEE-05 · Onda 1)
   (C) calcularMaquininhaFee — dinheiro/PIX/debito/credito, toggle desligado
   (C2) calcularAdicionalPagamentoFee — dinheiro/debito/credito cobram, PIX nao, toggle desligado
       (REF-DELIVERY-FEE-05 · Onda 2)
   (D) montarResumoFinanceiro — retirada, desativado, sem coordenadas, fora de alcance, ok (com/sem taxa,
       com/sem maquininha, com/sem adicional de pagamento), extrapolacao, pureza (nao muta input)
   (E) deliveryFeeConfigForm — paraEditavel/paraPersistirFaixas/validarFaixas (Admin: sobreposicao, inicio
       maior que fim, intervalo invalido, valores negativos, faixas duplicadas) */
import assert from 'node:assert/strict';
import { distanciaKm } from '../src/address/utils/coordinates.js';
import {
  localizarFaixa, arredondarDistanciaKm, resolverTaxaPorDistancia,
  calcularMaquininhaFee, calcularAdicionalPagamentoFee, montarResumoFinanceiro,
  MAQUININHA_METODOS, ADICIONAL_PAGAMENTO_METODOS,
} from '../src/services/delivery/deliveryFeeRules.js';
import { paraEditavel, paraPersistirFaixas, validarFaixas, valorMaquininhaValido, valorAdicionalPagamentoValido } from '../src/services/delivery/deliveryFeeConfigForm.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

/* Tabela comercial OFICIAL (REF-DELIVERY-FEE-05 · Onda 1, fornecida pelo dono 2026-09-04) — substitui a
   tabela antiga (era so' um modelo/exemplo, nunca a intencao comercial real). A partir de 7km, +R$2,00
   a cada +1km, SEM parar em 20km — ver incrementoAcimaFaixas/resolverTaxaPorDistancia. */
const FAIXAS_PADRAO = [
  { de: 0.0, ate: 4.0, valor: 10.00 }, { de: 4.1, ate: 5.0, valor: 12.00 },
  { de: 5.1, ate: 7.0, valor: 14.00 }, { de: 7.1, ate: 8.0, valor: 16.00 },
  { de: 8.1, ate: 9.0, valor: 18.00 }, { de: 9.1, ate: 10.0, valor: 20.00 },
  { de: 10.1, ate: 11.0, valor: 22.00 }, { de: 11.1, ate: 12.0, valor: 24.00 },
  { de: 12.1, ate: 13.0, valor: 26.00 }, { de: 13.1, ate: 14.0, valor: 28.00 },
  { de: 14.1, ate: 15.0, valor: 30.00 }, { de: 15.1, ate: 16.0, valor: 32.00 },
  { de: 16.1, ate: 17.0, valor: 34.00 }, { de: 17.1, ate: 18.0, valor: 36.00 },
  { de: 18.1, ate: 19.0, valor: 38.00 }, { de: 19.1, ate: 20.0, valor: 40.00 },
];
const INCREMENTO_PADRAO = 2.00;
const CONFIG_PADRAO = {
  version: 1, ativo: true, maquininha: { ativo: true, valor: 2.00 },
  adicionalPagamento: { ativo: true, valor: 2.00 }, incrementoAcimaFaixas: INCREMENTO_PADRAO,
  faixas: FAIXAS_PADRAO,
};

/* ── (A) distanciaKm ─────────────────────────────────────────────────────────────────────────── */
check('distanciaKm: mesmo ponto = 0', () => {
  const p = { lat: -26.795, lng: -49.270 };
  assert.strictEqual(distanciaKm(p, p), 0);
});
check('distanciaKm: Timbó -> Blumenau ~24km (tolerância 3km)', () => {
  const d = distanciaKm({ lat: -26.827, lng: -49.271 }, { lat: -26.919, lng: -49.066 });
  assert.ok(d > 18 && d < 27, `esperado ~18-27km, obtido ${d}`);
});
check('distanciaKm: coordenada ausente -> null', () => {
  assert.strictEqual(distanciaKm(null, { lat: 1, lng: 2 }), null);
  assert.strictEqual(distanciaKm({ lat: 1, lng: null }, { lat: 1, lng: 2 }), null);
  assert.strictEqual(distanciaKm({ lat: NaN, lng: 2 }, { lat: 1, lng: 2 }), null);
});

/* ── (B) localizarFaixa — tabela comercial OFICIAL ───────────────────────────────────────────────── */
check('localizarFaixa: todas as 16 faixas da tabela oficial (limite superior exato)', () => {
  for (const f of FAIXAS_PADRAO) {
    const achada = localizarFaixa(f.ate, FAIXAS_PADRAO);
    assert.strictEqual(achada?.valor, f.valor, `${f.ate}km deveria cair na faixa de R$${f.valor}`);
  }
});
check('localizarFaixa: casos de aceitação obrigatórios (4,0/4,1/5,0/5,1/7,0/7,1/8,0km)', () => {
  assert.strictEqual(localizarFaixa(4.0, FAIXAS_PADRAO)?.valor, 10.00);
  assert.strictEqual(localizarFaixa(4.1, FAIXAS_PADRAO)?.valor, 12.00);
  assert.strictEqual(localizarFaixa(5.0, FAIXAS_PADRAO)?.valor, 12.00);
  assert.strictEqual(localizarFaixa(5.1, FAIXAS_PADRAO)?.valor, 14.00);
  assert.strictEqual(localizarFaixa(7.0, FAIXAS_PADRAO)?.valor, 14.00);
  assert.strictEqual(localizarFaixa(7.1, FAIXAS_PADRAO)?.valor, 16.00);
  assert.strictEqual(localizarFaixa(8.0, FAIXAS_PADRAO)?.valor, 16.00);
});
check('localizarFaixa: casos reais da auditoria REF-DELIVERY-FEE-05 (~4,5km->R$12, ~5,7km->R$14)', () => {
  assert.strictEqual(localizarFaixa(4.5, FAIXAS_PADRAO)?.valor, 12.00);
  assert.strictEqual(localizarFaixa(5.7, FAIXAS_PADRAO)?.valor, 14.00);
});
check('localizarFaixa: 20,0km cai na última faixa cadastrada (R$40) — 20,1km fica fora de alcance (extrapolação é responsabilidade de resolverTaxaPorDistancia)', () => {
  assert.strictEqual(localizarFaixa(20.0, FAIXAS_PADRAO)?.valor, 40.00);
  assert.strictEqual(localizarFaixa(20.1, FAIXAS_PADRAO), null);
});
check('localizarFaixa: 0km cai na primeira faixa', () => {
  assert.strictEqual(localizarFaixa(0, FAIXAS_PADRAO)?.valor, 10.00);
});
check('localizarFaixa: distância inválida (negativa/NaN/null) -> null', () => {
  assert.strictEqual(localizarFaixa(-1, FAIXAS_PADRAO), null);
  assert.strictEqual(localizarFaixa(NaN, FAIXAS_PADRAO), null);
  assert.strictEqual(localizarFaixa(null, FAIXAS_PADRAO), null);
});
check('localizarFaixa: sem faixas cadastradas -> null', () => {
  assert.strictEqual(localizarFaixa(3, []), null);
  assert.strictEqual(localizarFaixa(3, null), null);
});

/* ── (B2) arredondarDistanciaKm / resolverTaxaPorDistancia ───────────────────────────────────────── */
check('arredondarDistanciaKm: arredonda para 1 casa decimal (política de precisão)', () => {
  assert.strictEqual(arredondarDistanciaKm(20.9999999999), 21.0);
  assert.strictEqual(arredondarDistanciaKm(21.0000000001), 21.0);
  assert.strictEqual(arredondarDistanciaKm(4.049), 4.0);
  assert.strictEqual(arredondarDistanciaKm(4.05), 4.1);
});
check('resolverTaxaPorDistancia: ambiguidade de ponto flutuante na fronteira -> SEMPRE a mesma faixa', () => {
  const a = resolverTaxaPorDistancia(20.9999999999, FAIXAS_PADRAO, INCREMENTO_PADRAO);
  const b = resolverTaxaPorDistancia(21.0000000001, FAIXAS_PADRAO, INCREMENTO_PADRAO);
  assert.strictEqual(a.valor, 42.00);
  assert.strictEqual(b.valor, 42.00);
});
check('resolverTaxaPorDistancia: faixa exata (dentro da tabela) -> nao extrapola', () => {
  const r = resolverTaxaPorDistancia(4.5, FAIXAS_PADRAO, INCREMENTO_PADRAO);
  assert.strictEqual(r.valor, 12.00);
  assert.strictEqual(r.extrapolado, false);
  assert.ok(r.faixa);
});
check('resolverTaxaPorDistancia: casos obrigatórios de extrapolação acima de 20km', () => {
  const casos = [
    [20.0, 40.00, false], [20.1, 42.00, true], [21.0, 42.00, true], [21.1, 44.00, true],
    [23.0, 46.00, true], [25.0, 50.00, true],
  ];
  for (const [km, esperado, extrapolado] of casos) {
    const r = resolverTaxaPorDistancia(km, FAIXAS_PADRAO, INCREMENTO_PADRAO);
    assert.strictEqual(r.valor, esperado, `${km}km deveria custar R$${esperado}, obtido R$${r.valor}`);
    assert.strictEqual(r.extrapolado, extrapolado, `${km}km: extrapolado deveria ser ${extrapolado}`);
  }
});
check('resolverTaxaPorDistancia: sem incrementoAcimaFaixas (ausente/0/negativo) -> null (fora de alcance, comportamento antigo preservado)', () => {
  assert.strictEqual(resolverTaxaPorDistancia(25.0, FAIXAS_PADRAO, undefined), null);
  assert.strictEqual(resolverTaxaPorDistancia(25.0, FAIXAS_PADRAO, 0), null);
  assert.strictEqual(resolverTaxaPorDistancia(25.0, FAIXAS_PADRAO, -2), null);
});
check('resolverTaxaPorDistancia: sem faixas cadastradas -> null mesmo com incremento válido', () => {
  assert.strictEqual(resolverTaxaPorDistancia(25.0, [], INCREMENTO_PADRAO), null);
});
check('resolverTaxaPorDistancia: distância inválida -> null', () => {
  assert.strictEqual(resolverTaxaPorDistancia(-1, FAIXAS_PADRAO, INCREMENTO_PADRAO), null);
  assert.strictEqual(resolverTaxaPorDistancia(NaN, FAIXAS_PADRAO, INCREMENTO_PADRAO), null);
});

/* ── (C) calcularMaquininhaFee ───────────────────────────────────────────────────────────────── */
const MAQ_ATIVA = { ativo: true, valor: 2.00 };
check('maquininha: débito e crédito cobram', () => {
  assert.strictEqual(calcularMaquininhaFee('cartao_debito', MAQ_ATIVA), 2.00);
  assert.strictEqual(calcularMaquininhaFee('cartao_credito', MAQ_ATIVA), 2.00);
});
check('maquininha: dinheiro e PIX NÃO cobram (não usam o aparelho)', () => {
  assert.strictEqual(calcularMaquininhaFee('dinheiro', MAQ_ATIVA), 0);
  assert.strictEqual(calcularMaquininhaFee('pix', MAQ_ATIVA), 0);
});
check('maquininha: toggle desligado nunca cobra, mesmo em cartão', () => {
  assert.strictEqual(calcularMaquininhaFee('cartao_credito', { ativo: false, valor: 2.00 }), 0);
});
check('maquininha: config ausente -> 0 (nunca lança)', () => {
  assert.strictEqual(calcularMaquininhaFee('cartao_credito', null), 0);
  assert.strictEqual(calcularMaquininhaFee('cartao_credito', undefined), 0);
});
check('MAQUININHA_METODOS é exatamente [cartao_debito, cartao_credito]', () => {
  assert.deepStrictEqual(MAQUININHA_METODOS, ['cartao_debito', 'cartao_credito']);
});

/* ── (C2) calcularAdicionalPagamentoFee — REF-DELIVERY-FEE-05 · Onda 2 ──────────────────────────── */
const ADIC_ATIVO = { ativo: true, valor: 2.00 };
check('adicional de pagamento: dinheiro, débito e crédito cobram', () => {
  assert.strictEqual(calcularAdicionalPagamentoFee('dinheiro', ADIC_ATIVO), 2.00);
  assert.strictEqual(calcularAdicionalPagamentoFee('cartao_debito', ADIC_ATIVO), 2.00);
  assert.strictEqual(calcularAdicionalPagamentoFee('cartao_credito', ADIC_ATIVO), 2.00);
});
check('adicional de pagamento: PIX NÃO cobra', () => {
  assert.strictEqual(calcularAdicionalPagamentoFee('pix', ADIC_ATIVO), 0);
});
check('adicional de pagamento: toggle desligado nunca cobra, mesmo em dinheiro', () => {
  assert.strictEqual(calcularAdicionalPagamentoFee('dinheiro', { ativo: false, valor: 2.00 }), 0);
});
check('adicional de pagamento: config ausente -> {ativo:true,valor:2.00} ("já nasce ligado"), nunca 0 por engano', () => {
  assert.strictEqual(calcularAdicionalPagamentoFee('dinheiro', null), 2.00);
  assert.strictEqual(calcularAdicionalPagamentoFee('dinheiro', undefined), 2.00);
  assert.strictEqual(calcularAdicionalPagamentoFee('pix', null), 0);   // PIX continua de fora mesmo no default
});
check('ADICIONAL_PAGAMENTO_METODOS é exatamente [dinheiro, cartao_debito, cartao_credito] (oposto de MAQUININHA_METODOS)', () => {
  assert.deepStrictEqual(ADICIONAL_PAGAMENTO_METODOS, ['dinheiro', 'cartao_debito', 'cartao_credito']);
});
check('adicional de pagamento: mutuamente exclusivo com maquininha (REF-DELIVERY-FEE-05 Onda 4) -- nunca soma R$4', () => {
  assert.strictEqual(calcularAdicionalPagamentoFee('cartao_credito', ADIC_ATIVO, 2.00), 0);
  assert.strictEqual(calcularAdicionalPagamentoFee('cartao_debito', ADIC_ATIVO, 2.00), 0);
  // dinheiro nunca aciona maquininha -- continua cobrando o adicional normalmente mesmo se um
  // valor de maquininha fosse (hipoteticamente) passado.
  assert.strictEqual(calcularAdicionalPagamentoFee('dinheiro', ADIC_ATIVO, 0), 2.00);
});

/* ── (D) montarResumoFinanceiro ──────────────────────────────────────────────────────────────── */
check('resumo: retirada nunca tem taxa, maquininha nem adicional de pagamento (mesmo com cartão)', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: true, distanciaKm: 3, config: CONFIG_PADRAO, paymentMethod: 'cartao_credito' });
  assert.deepStrictEqual(r, { subtotal: 50, distanciaKm: null, faixa: null, faixaExtrapolada: false, deliveryFee: 0, maquininhaFee: 0, adicionalPagamentoFee: 0, total: 50, status: 'retirada', configuracaoPropria: true });
});
check('resumo: configuracaoPropria default true quando config não traz o campo (compat)', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 4.5, config: CONFIG_PADRAO, paymentMethod: 'pix' });
  assert.strictEqual(r.configuracaoPropria, true);
});
check('resumo: configuracaoPropria false quando config.configuracao_propria === false, mesmo com faixa/status ok', () => {
  const cfg = { ...CONFIG_PADRAO, configuracao_propria: false };
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 4.5, config: cfg, paymentMethod: 'pix' });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.configuracaoPropria, false);
});
check('resumo: feature desativada -> sem taxa de entrega, maquininha e adicional continuam mutuamente exclusivos', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: 3, config: { ...CONFIG_PADRAO, ativo: false }, paymentMethod: 'cartao_credito' });
  assert.strictEqual(r.deliveryFee, 0);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.adicionalPagamentoFee, 0);   // REF-DELIVERY-FEE-05 Onda 4: exclusivo com maquininha
  assert.strictEqual(r.total, 52.00);
  assert.strictEqual(r.status, 'desativado');
});
check('resumo: sem coordenadas -> taxa 0 + status honesto, checkout nunca bloqueia', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: null, config: CONFIG_PADRAO, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.deliveryFee, 0);
  assert.strictEqual(r.status, 'sem_coordenadas');
  assert.strictEqual(r.adicionalPagamentoFee, 2.00);   // independe de distância, igual à maquininha
  assert.strictEqual(r.total, 52.00);
});
check('resumo: fora de alcance (incrementoAcimaFaixas explicitamente 0/desativado) -> taxa 0 + status honesto, acrescimos continuam', () => {
  // incrementoAcimaFaixas AUSENTE (undefined/null) cai no default 2.00 ("já nasce ligado", ver ??
  // em montarResumoFinanceiro) -- só fica sem extrapolação com um valor <= 0 explicitamente presente.
  const cfg = { ...CONFIG_PADRAO, incrementoAcimaFaixas: 0 };
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: 25, config: cfg, paymentMethod: 'cartao_debito' });
  assert.strictEqual(r.deliveryFee, 0);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.adicionalPagamentoFee, 0);   // REF-DELIVERY-FEE-05 Onda 4: exclusivo com maquininha
  assert.strictEqual(r.status, 'fora_de_alcance');
});
check('resumo: PIX dentro da faixa -> taxa de entrega, sem maquininha nem adicional de pagamento', () => {
  const r = montarResumoFinanceiro({ subtotal: 43.50, retirada: false, distanciaKm: 4.2, config: CONFIG_PADRAO, paymentMethod: 'pix' });
  assert.strictEqual(r.deliveryFee, 12.00);
  assert.strictEqual(r.maquininhaFee, 0);
  assert.strictEqual(r.adicionalPagamentoFee, 0);
  assert.strictEqual(r.total, 55.50);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.faixa.valor, 12.00);
  assert.strictEqual(r.faixaExtrapolada, false);
});
check('resumo: dinheiro dentro da faixa -> taxa de entrega + adicional de pagamento, SEM maquininha', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 5.7, config: CONFIG_PADRAO, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.deliveryFee, 14.00);
  assert.strictEqual(r.maquininhaFee, 0);
  assert.strictEqual(r.adicionalPagamentoFee, 2.00);
  assert.strictEqual(r.total, 46.00);
  assert.strictEqual(r.status, 'ok');
});
check('resumo: crédito dentro da faixa -> taxa de entrega + maquininha, SEM adicional (REF-DELIVERY-FEE-05 Onda 4: mutuamente exclusivos, nunca R$4 somados)', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 16.5, config: CONFIG_PADRAO, paymentMethod: 'cartao_credito' });
  assert.strictEqual(r.deliveryFee, 34.00);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.adicionalPagamentoFee, 0);
  assert.strictEqual(r.total, 66.00);
  assert.strictEqual(r.status, 'ok');
});
check('resumo: extrapolação acima de 20km reflete no resumo completo (25km, crédito, sem dobrar acréscimo)', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 25.0, config: CONFIG_PADRAO, paymentMethod: 'cartao_credito' });
  assert.strictEqual(r.deliveryFee, 50.00);
  assert.strictEqual(r.faixaExtrapolada, true);
  assert.strictEqual(r.faixa, null);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.adicionalPagamentoFee, 0);
  assert.strictEqual(r.total, 82.00);
  assert.strictEqual(r.status, 'ok');
});
check('resumo: maquininha desligada no config -> só a taxa de entrega + adicional de pagamento, mesmo em débito', () => {
  const cfg = { ...CONFIG_PADRAO, maquininha: { ativo: false, valor: 2.00 } };
  const r = montarResumoFinanceiro({ subtotal: 20, retirada: false, distanciaKm: 2, config: cfg, paymentMethod: 'cartao_debito' });
  assert.strictEqual(r.deliveryFee, 10.00);
  assert.strictEqual(r.maquininhaFee, 0);
  assert.strictEqual(r.adicionalPagamentoFee, 2.00);
  assert.strictEqual(r.total, 32.00);
});
check('resumo: adicional de pagamento desligado no config -> só a taxa de entrega + maquininha, mesmo em dinheiro', () => {
  const cfg = { ...CONFIG_PADRAO, adicionalPagamento: { ativo: false, valor: 2.00 } };
  const r = montarResumoFinanceiro({ subtotal: 20, retirada: false, distanciaKm: 2, config: cfg, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.deliveryFee, 10.00);
  assert.strictEqual(r.maquininhaFee, 0);
  assert.strictEqual(r.adicionalPagamentoFee, 0);
  assert.strictEqual(r.total, 30.00);
});
check('resumo: pureza — não muta os objetos de entrada', () => {
  const config = structuredClone(CONFIG_PADRAO);
  const antes = JSON.stringify(config);
  montarResumoFinanceiro({ subtotal: 20, retirada: false, distanciaKm: 8, config, paymentMethod: 'cartao_debito' });
  assert.strictEqual(JSON.stringify(config), antes);
});
check('resumo: subtotal ausente/inválido cai em 0 (nunca NaN)', () => {
  const r = montarResumoFinanceiro({ subtotal: undefined, retirada: false, distanciaKm: 2, config: CONFIG_PADRAO, paymentMethod: 'pix' });
  assert.strictEqual(r.subtotal, 0);
  assert.strictEqual(r.total, 10.00);
});

/* ── (E) deliveryFeeConfigForm ───────────────────────────────────────────────────────────────── */
let seq = 0;
const nextId = () => (seq += 1);

check('paraEditavel: cada faixa ganha _id local, valores viram string p/ input', () => {
  seq = 0;
  const editavel = paraEditavel([{ de: 0, ate: 4, valor: 10 }, { de: 4.1, ate: 5, valor: 12 }], nextId);
  assert.deepStrictEqual(editavel, [{ _id: 1, de: '0', ate: '4', valor: '10' }, { _id: 2, de: '4.1', ate: '5', valor: '12' }]);
});
check('paraEditavel: config vazia/ausente -> lista vazia', () => {
  assert.deepStrictEqual(paraEditavel(undefined, nextId), []);
  assert.deepStrictEqual(paraEditavel([], nextId), []);
});
check('paraPersistirFaixas: remove _id, converte p/ número, ordena por "de"', () => {
  const persistido = paraPersistirFaixas([{ _id: 2, de: '4.1', ate: '5', valor: '12' }, { _id: 1, de: '0', ate: '4', valor: '10' }]);
  assert.deepStrictEqual(persistido, [{ de: 0, ate: 4, valor: 10 }, { de: 4.1, ate: 5, valor: 12 }]);
});
check('paraPersistirFaixas: ida-e-volta preserva a tabela oficial', () => {
  seq = 0;
  const editavel = paraEditavel(FAIXAS_PADRAO, nextId);
  assert.deepStrictEqual(paraPersistirFaixas(editavel), FAIXAS_PADRAO);
});
check('paraPersistirFaixas: linha com número inválido é descartada (defesa em profundidade)', () => {
  const persistido = paraPersistirFaixas([{ _id: 1, de: 'abc', ate: '5', valor: '10' }]);
  assert.deepStrictEqual(persistido, []);
});

check('validarFaixas: tabela oficial inteira -> zero erros', () => {
  seq = 0;
  const editavel = paraEditavel(FAIXAS_PADRAO, nextId);
  assert.strictEqual(validarFaixas(editavel).size, 0);
});
check('validarFaixas: início maior que fim ("ate" <= "de") -> erro', () => {
  const erros = validarFaixas([{ _id: 1, de: '5', ate: '3', valor: '10' }]);
  assert.strictEqual(erros.size, 1);
});
check('validarFaixas: intervalo inválido (de == ate) -> erro', () => {
  const erros = validarFaixas([{ _id: 1, de: '5', ate: '5', valor: '10' }]);
  assert.strictEqual(erros.size, 1);
});
check('validarFaixas: valores negativos (de e valor) -> erro', () => {
  assert.strictEqual(validarFaixas([{ _id: 1, de: '-1', ate: '5', valor: '10' }]).size, 1);
  assert.strictEqual(validarFaixas([{ _id: 1, de: '0', ate: '5', valor: '-10' }]).size, 1);
});
check('validarFaixas: faixas duplicadas (mesmo de+ate) -> erro nas 2 linhas', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '4', valor: '10' }, { _id: 2, de: '0', ate: '4', valor: '11' }]);
  assert.strictEqual(erros.size, 2);
});
check('validarFaixas: sobreposição (0-6 e 5-10) -> erro nas 2 linhas', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '6', valor: '10' }, { _id: 2, de: '5', ate: '10', valor: '12' }]);
  assert.strictEqual(erros.size, 2);
});
check('validarFaixas: toque exato nos limites (0-4 e 4-10) -> permitido (mesma semântica de business_hours_schedule: toque não é sobreposição)', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '4', valor: '10' }, { _id: 2, de: '4', ate: '10', valor: '12' }]);
  assert.strictEqual(erros.size, 0);
});
check('validarFaixas: gap de 0.1 (0-4 e 4.1-10) -> sem sobreposição, zero erros', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '4', valor: '10' }, { _id: 2, de: '4.1', ate: '10', valor: '12' }]);
  assert.strictEqual(erros.size, 0);
});
check('validarFaixas: texto não numérico -> erro', () => {
  const erros = validarFaixas([{ _id: 1, de: 'abc', ate: '5', valor: '10' }]);
  assert.strictEqual(erros.size, 1);
});

check('valorMaquininhaValido: número >= 0 é válido', () => {
  assert.strictEqual(valorMaquininhaValido('2.00'), true);
  assert.strictEqual(valorMaquininhaValido(0), true);
});
check('valorMaquininhaValido: negativo ou não numérico é inválido', () => {
  assert.strictEqual(valorMaquininhaValido('-1'), false);
  assert.strictEqual(valorMaquininhaValido('abc'), false);
});
check('valorAdicionalPagamentoValido: mesma validação, nome próprio (número >= 0 é válido)', () => {
  assert.strictEqual(valorAdicionalPagamentoValido('2.00'), true);
  assert.strictEqual(valorAdicionalPagamentoValido(0), true);
  assert.strictEqual(valorAdicionalPagamentoValido('-1'), false);
  assert.strictEqual(valorAdicionalPagamentoValido('abc'), false);
});

console.log(fail === 0 ? '✅ deliveryFee.golden OK' : `❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
