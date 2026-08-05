/* services/delivery/deliveryFeeConfigForm.js — REF-DELIVERY-FEE-01.
   Logica PURA do formulario do Admin (transformacao + validacao) — separada de AdminTaxaEntrega.jsx para
   ser testavel em Node sem montar React (mesmo espirito de services/businessHours/scheduleForm.js). Espelha,
   no cliente, a MESMA validacao que set_delivery_fee_config (RPC) roda no servidor — o servidor SEMPRE
   revalida (nunca confia so no cliente), mas o cliente da feedback imediato por faixa sem round-trip. */

/* config.faixas (persistido, numerico, sem _id) -> lista EDITAVEL (strings dos inputs + _id sintetico p/
   key/React). `nextId` e injetado pelo chamador (contador estavel entre renders, ex.: useRef no componente). */
export function paraEditavel(faixas, nextId) {
  const lista = Array.isArray(faixas) ? faixas : [];
  return lista.map((f) => ({ _id: nextId(), de: String(f.de), ate: String(f.ate), valor: String(f.valor) }));
}

/* lista EDITAVEL (strings dos inputs) -> faixas CANONICAS numericas, ordenadas por "de" (sem _id). Filtra
   linhas com numero invalido — a validacao/erro em tela ja cobriu esse caso antes do Salvar ficar
   habilitado; aqui e so defesa em profundidade (mesmo papel de scheduleForm.paraPersistir). */
export function paraPersistirFaixas(faixas) {
  return faixas
    .map((f) => ({ de: Number(f.de), ate: Number(f.ate), valor: Number(f.valor) }))
    .filter((f) => Number.isFinite(f.de) && Number.isFinite(f.ate) && Number.isFinite(f.valor))
    .sort((a, b) => a.de - b.de);
}

/* Validacao de UMA lista de faixas editaveis: numero invalido, negativo, ate<=de, duplicada, sobreposta.
   Retorna Map(_id -> mensagem), so as faixas com problema entram no mapa (mesmas regras do RPC
   set_delivery_fee_config, ver migrations/REF-DELIVERY-FEE-01-step1-fee-config-rpc.sql). */
export function validarFaixas(faixas) {
  const erros = new Map();
  const numericas = [];
  faixas.forEach((f) => {
    const de = Number(f.de), ate = Number(f.ate), valor = Number(f.valor);
    if (!Number.isFinite(de) || !Number.isFinite(ate) || !Number.isFinite(valor)) {
      erros.set(f._id, 'Preencha De/Até/Valor com números válidos'); return;
    }
    if (de < 0 || valor < 0) { erros.set(f._id, 'Valores não podem ser negativos'); return; }
    if (ate <= de) { erros.set(f._id, '"Até" deve ser maior que "De"'); return; }
    numericas.push({ _id: f._id, de, ate });
  });

  // duplicadas: mesmo par de+ate.
  const vistos = new Map();
  numericas.forEach((f) => {
    const chave = `${f.de}-${f.ate}`;
    if (vistos.has(chave)) { erros.set(f._id, 'Faixa duplicada'); erros.set(vistos.get(chave), 'Faixa duplicada'); }
    else vistos.set(chave, f._id);
  });

  // sobreposicao: percorre em ordem crescente de "de" (só entre as que já passaram na validação acima);
  // cada faixa só pode começar no fim (ou depois) da anterior.
  const ordenadas = numericas.filter((f) => !erros.has(f._id)).sort((a, b) => a.de - b.de);
  for (let i = 1; i < ordenadas.length; i++) {
    if (ordenadas[i].de < ordenadas[i - 1].ate) {
      erros.set(ordenadas[i]._id, 'Faixa sobreposta com a faixa anterior');
      erros.set(ordenadas[i - 1]._id, 'Faixa sobreposta com a próxima faixa');
    }
  }
  return erros;
}

/* Valida o valor (R$) do acréscimo de maquininha — número finito >= 0. */
export function valorMaquininhaValido(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0;
}
