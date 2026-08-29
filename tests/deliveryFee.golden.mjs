/* tests/deliveryFee.golden.mjs — REF-DELIVERY-FEE-01 · roda com:  node tests/deliveryFee.golden.mjs
   Valida a camada UNICA de regra de negocio da taxa de entrega por distancia (services/delivery/
   deliveryFeeRules.js) + o haversine (address/utils/coordinates.js):
   (A) distanciaKm — pontos iguais, distancia conhecida, coordenadas invalidas
   (B) localizarFaixa — todas as 17 faixas da tabela padrao, mudanca entre faixas, fora de alcance
   (C) calcularMaquininhaFee — dinheiro/PIX/debito/credito, toggle desligado
   (D) montarResumoFinanceiro — retirada, desativado, sem coordenadas, fora de alcance, ok (com/sem taxa,
       com/sem maquininha), pureza (nao muta input)
   (E) deliveryFeeConfigForm — paraEditavel/paraPersistirFaixas/validarFaixas (Admin: sobreposicao, inicio
       maior que fim, intervalo invalido, valores negativos, faixas duplicadas) */
import assert from 'node:assert/strict';
import { distanciaKm } from '../src/address/utils/coordinates.js';
import { localizarFaixa, calcularMaquininhaFee, montarResumoFinanceiro, MAQUININHA_METODOS } from '../src/services/delivery/deliveryFeeRules.js';
import { paraEditavel, paraPersistirFaixas, validarFaixas, valorMaquininhaValido } from '../src/services/delivery/deliveryFeeConfigForm.js';

let fail = 0;
const check = (m, fn) => { try { fn(); } catch (e) { fail++; console.error('✗', m, '—', e?.message ?? e); } };

/* Tabela padrao (mesma semente da migration REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql). */
const FAIXAS_PADRAO = [
  { de: 0.0, ate: 5.0, valor: 10.00 }, { de: 5.1, ate: 6.0, valor: 12.00 },
  { de: 6.1, ate: 7.0, valor: 14.00 }, { de: 7.1, ate: 8.0, valor: 16.00 },
  { de: 8.1, ate: 9.0, valor: 18.00 }, { de: 9.1, ate: 10.0, valor: 20.00 },
  { de: 10.1, ate: 11.0, valor: 22.00 }, { de: 11.1, ate: 12.0, valor: 24.00 },
  { de: 12.1, ate: 13.0, valor: 26.00 }, { de: 13.1, ate: 14.0, valor: 28.00 },
  { de: 14.1, ate: 15.0, valor: 30.00 }, { de: 15.1, ate: 16.0, valor: 32.00 },
  { de: 16.1, ate: 17.0, valor: 34.00 }, { de: 17.1, ate: 18.0, valor: 36.00 },
  { de: 18.1, ate: 19.0, valor: 38.00 }, { de: 19.1, ate: 20.0, valor: 40.00 },
  { de: 20.1, ate: 21.0, valor: 42.00 },
];
const CONFIG_PADRAO = { version: 1, ativo: true, maquininha: { ativo: true, valor: 2.00 }, faixas: FAIXAS_PADRAO };

/* ── (A) distanciaKm ─────────────────────────────────────────────────────────────────────────── */
check('distanciaKm: mesmo ponto = 0', () => {
  const p = { lat: -26.795, lng: -49.270 };
  assert.strictEqual(distanciaKm(p, p), 0);
});
check('distanciaKm: Timbó -> Blumenau ~24km (tolerância 3km)', () => {
  // Timbó/SC ~ -26.827, -49.271 · Blumenau/SC ~ -26.919, -49.066
  const d = distanciaKm({ lat: -26.827, lng: -49.271 }, { lat: -26.919, lng: -49.066 });
  assert.ok(d > 18 && d < 27, `esperado ~18-27km, obtido ${d}`);
});
check('distanciaKm: coordenada ausente -> null', () => {
  assert.strictEqual(distanciaKm(null, { lat: 1, lng: 2 }), null);
  assert.strictEqual(distanciaKm({ lat: 1, lng: null }, { lat: 1, lng: 2 }), null);
  assert.strictEqual(distanciaKm({ lat: NaN, lng: 2 }, { lat: 1, lng: 2 }), null);
});

/* ── (B) localizarFaixa ──────────────────────────────────────────────────────────────────────── */
check('localizarFaixa: todas as 17 faixas da tabela padrão (limite superior exato)', () => {
  for (const f of FAIXAS_PADRAO) {
    const achada = localizarFaixa(f.ate, FAIXAS_PADRAO);
    assert.strictEqual(achada?.valor, f.valor, `${f.ate}km deveria cair na faixa de R$${f.valor}`);
  }
});
check('localizarFaixa: meio da faixa (ex. 3km -> R$10, 15.5km -> R$32)', () => {
  assert.strictEqual(localizarFaixa(3, FAIXAS_PADRAO)?.valor, 10.00);
  assert.strictEqual(localizarFaixa(15.5, FAIXAS_PADRAO)?.valor, 32.00);
});
check('localizarFaixa: buraco de exibição entre faixas (5.05km cai na faixa seguinte, nunca fica sem cobertura)', () => {
  assert.strictEqual(localizarFaixa(5.05, FAIXAS_PADRAO)?.valor, 12.00);
});
check('localizarFaixa: mudança exata de faixa (5.0 -> R$10, 5.1 -> R$12)', () => {
  assert.strictEqual(localizarFaixa(5.0, FAIXAS_PADRAO)?.valor, 10.00);
  assert.strictEqual(localizarFaixa(5.1, FAIXAS_PADRAO)?.valor, 12.00);
});
check('localizarFaixa: 0km cai na primeira faixa', () => {
  assert.strictEqual(localizarFaixa(0, FAIXAS_PADRAO)?.valor, 10.00);
});
check('localizarFaixa: acima da última faixa (21.5km) -> null (fora de alcance)', () => {
  assert.strictEqual(localizarFaixa(21.5, FAIXAS_PADRAO), null);
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

/* ── (D) montarResumoFinanceiro ──────────────────────────────────────────────────────────────── */
check('resumo: retirada nunca tem taxa nem maquininha (mesmo com cartão)', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: true, distanciaKm: 3, config: CONFIG_PADRAO, paymentMethod: 'cartao_credito' });
  assert.deepStrictEqual(r, { subtotal: 50, distanciaKm: null, faixa: null, deliveryFee: 0, maquininhaFee: 0, total: 50, status: 'retirada', configuracaoPropria: true });
});
/* REF-STORE-ONBOARD-02 · Onda 2: configuracaoPropria deriva de config.configuracao_propria (vindo do
   RPC get_delivery_fee_config) -- default true (sem aviso) quando ausente, nunca confundido com
   'sem_coordenadas'/'fora_de_alcance' (estados de distância, já cobertos por `status`). */
check('resumo: configuracaoPropria default true quando config não traz o campo (compat)', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 4, config: CONFIG_PADRAO, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.configuracaoPropria, true);
});
check('resumo: configuracaoPropria false quando config.configuracao_propria === false, mesmo com faixa/status ok', () => {
  const cfg = { ...CONFIG_PADRAO, configuracao_propria: false };
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 4, config: cfg, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.configuracaoPropria, false);
});
check('resumo: configuracaoPropria false não muda deliveryFee/total -- só sinaliza proveniência', () => {
  const proprio = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 4, config: CONFIG_PADRAO, paymentMethod: 'dinheiro' });
  const padrao = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 4, config: { ...CONFIG_PADRAO, configuracao_propria: false }, paymentMethod: 'dinheiro' });
  assert.strictEqual(proprio.deliveryFee, padrao.deliveryFee);
  assert.strictEqual(proprio.total, padrao.total);
});
check('resumo: sem_coordenadas mantém configuracaoPropria independente (estados nunca se confundem)', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: null, config: { ...CONFIG_PADRAO, configuracao_propria: false }, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.status, 'sem_coordenadas');
  assert.strictEqual(r.configuracaoPropria, false);
});
check('resumo: feature desativada -> sem taxa de entrega, mas maquininha continua independente', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: 3, config: { ...CONFIG_PADRAO, ativo: false }, paymentMethod: 'cartao_credito' });
  assert.strictEqual(r.deliveryFee, 0);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.total, 52.00);
  assert.strictEqual(r.status, 'desativado');
});
check('resumo: sem coordenadas -> taxa 0 + status honesto, checkout nunca bloqueia', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: null, config: CONFIG_PADRAO, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.deliveryFee, 0);
  assert.strictEqual(r.status, 'sem_coordenadas');
  assert.strictEqual(r.total, 50);
});
check('resumo: fora de alcance (25km) -> taxa 0 + status honesto, maquininha ainda aplica', () => {
  const r = montarResumoFinanceiro({ subtotal: 50, retirada: false, distanciaKm: 25, config: CONFIG_PADRAO, paymentMethod: 'cartao_debito' });
  assert.strictEqual(r.deliveryFee, 0);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.status, 'fora_de_alcance');
});
check('resumo: PIX dentro da faixa -> taxa de entrega sem maquininha', () => {
  const r = montarResumoFinanceiro({ subtotal: 43.50, retirada: false, distanciaKm: 4.2, config: CONFIG_PADRAO, paymentMethod: 'pix' });
  assert.strictEqual(r.deliveryFee, 10.00);
  assert.strictEqual(r.maquininhaFee, 0);
  assert.strictEqual(r.total, 53.50);
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.faixa.valor, 10.00);
});
check('resumo: crédito dentro da faixa -> taxa de entrega + maquininha somadas', () => {
  const r = montarResumoFinanceiro({ subtotal: 30, retirada: false, distanciaKm: 16.5, config: CONFIG_PADRAO, paymentMethod: 'cartao_credito' });
  assert.strictEqual(r.deliveryFee, 34.00);
  assert.strictEqual(r.maquininhaFee, 2.00);
  assert.strictEqual(r.total, 66.00);
  assert.strictEqual(r.status, 'ok');
});
check('resumo: maquininha desligada no config -> só a taxa de entrega, mesmo em débito', () => {
  const cfg = { ...CONFIG_PADRAO, maquininha: { ativo: false, valor: 2.00 } };
  const r = montarResumoFinanceiro({ subtotal: 20, retirada: false, distanciaKm: 2, config: cfg, paymentMethod: 'cartao_debito' });
  assert.strictEqual(r.deliveryFee, 10.00);
  assert.strictEqual(r.maquininhaFee, 0);
  assert.strictEqual(r.total, 30.00);
});
check('resumo: pureza — não muta os objetos de entrada', () => {
  const config = structuredClone(CONFIG_PADRAO);
  const antes = JSON.stringify(config);
  montarResumoFinanceiro({ subtotal: 20, retirada: false, distanciaKm: 8, config, paymentMethod: 'cartao_debito' });
  assert.strictEqual(JSON.stringify(config), antes);
});
check('resumo: subtotal ausente/inválido cai em 0 (nunca NaN)', () => {
  const r = montarResumoFinanceiro({ subtotal: undefined, retirada: false, distanciaKm: 2, config: CONFIG_PADRAO, paymentMethod: 'dinheiro' });
  assert.strictEqual(r.subtotal, 0);
  assert.strictEqual(r.total, 10.00);
});

/* ── (E) deliveryFeeConfigForm ───────────────────────────────────────────────────────────────── */
let seq = 0;
const nextId = () => (seq += 1);

check('paraEditavel: cada faixa ganha _id local, valores viram string p/ input', () => {
  seq = 0;
  const editavel = paraEditavel([{ de: 0, ate: 5, valor: 10 }, { de: 5.1, ate: 6, valor: 12 }], nextId);
  assert.deepStrictEqual(editavel, [{ _id: 1, de: '0', ate: '5', valor: '10' }, { _id: 2, de: '5.1', ate: '6', valor: '12' }]);
});
check('paraEditavel: config vazia/ausente -> lista vazia', () => {
  assert.deepStrictEqual(paraEditavel(undefined, nextId), []);
  assert.deepStrictEqual(paraEditavel([], nextId), []);
});
check('paraPersistirFaixas: remove _id, converte p/ número, ordena por "de"', () => {
  const persistido = paraPersistirFaixas([{ _id: 2, de: '5.1', ate: '6', valor: '12' }, { _id: 1, de: '0', ate: '5', valor: '10' }]);
  assert.deepStrictEqual(persistido, [{ de: 0, ate: 5, valor: 10 }, { de: 5.1, ate: 6, valor: 12 }]);
});
check('paraPersistirFaixas: ida-e-volta preserva a tabela padrão', () => {
  seq = 0;
  const editavel = paraEditavel(FAIXAS_PADRAO, nextId);
  assert.deepStrictEqual(paraPersistirFaixas(editavel), FAIXAS_PADRAO);
});
check('paraPersistirFaixas: linha com número inválido é descartada (defesa em profundidade)', () => {
  const persistido = paraPersistirFaixas([{ _id: 1, de: 'abc', ate: '5', valor: '10' }]);
  assert.deepStrictEqual(persistido, []);
});

check('validarFaixas: tabela padrão inteira -> zero erros', () => {
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
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '5', valor: '10' }, { _id: 2, de: '0', ate: '5', valor: '11' }]);
  assert.strictEqual(erros.size, 2);
});
check('validarFaixas: sobreposição (0-6 e 5-10) -> erro nas 2 linhas', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '6', valor: '10' }, { _id: 2, de: '5', ate: '10', valor: '12' }]);
  assert.strictEqual(erros.size, 2);
});
check('validarFaixas: toque exato nos limites (0-5 e 5-10) -> permitido (mesma semântica de business_hours_schedule: toque não é sobreposição)', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '5', valor: '10' }, { _id: 2, de: '5', ate: '10', valor: '12' }]);
  assert.strictEqual(erros.size, 0);
});
check('validarFaixas: gap de 0.1 (0-5 e 5.1-10) -> sem sobreposição, zero erros', () => {
  const erros = validarFaixas([{ _id: 1, de: '0', ate: '5', valor: '10' }, { _id: 2, de: '5.1', ate: '10', valor: '12' }]);
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

console.log(fail === 0 ? '✅ deliveryFee.golden OK' : `❌ ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
