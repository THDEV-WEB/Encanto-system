/* components/admin/comanda/comandaHtml.js — REF-ORDER-01 · Parte 1 (lapidacao de apresentacao).
   Gerador PURO do documento da comanda: view-model (buildComanda) -> string HTML autocontida
   (estilo embutido). Sem React, sem DOM, sem IO — roda em Node (golden test) e serve tanto ao
   preview (iframe srcDoc) quanto a impressao (iframe oculto). FONTE UNICA de layout/estilo da comanda:
   preview e impressao usam EXATAMENTE este HTML (WYSIWYG), 100% desacoplado do index.css do app.

   DIRETRIZES PROFISSIONAIS (impressora termica ~203dpi, cozinha sob pressao):
   - CONTRASTE: tudo em PRETO PURO (#000), separadores SOLIDOS/DASHED pretos (nada de cinza claro que
     imprime fraco/sumido). Sem cor de fundo (nao gasta ribbon).
   - HIERARQUIA: numero do pedido = ancora dominante; tipo (ENTREGA/RETIRADA) em destaque; ITENS e o
     bloco de maior peso (e o que a cozinha le primeiro). Endereco forte (critico p/ o entregador).
   - TIPOGRAFIA: minimos legiveis (item ~15px, adicionais/obs ~12.5px), pesos altos, respiro entre blocos.
   Apenas apresentacao — o view-model (comandaModel) e a separacao Model->HTML->Impressao permanecem intactos.
   Preparado para futuras impressoras: o mesmo view-model pode alimentar um encoder ESC/POS sem tocar aqui. */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PAPEis = {
  '80mm': { page: '80mm', w: '72mm' },
  '58mm': { page: '58mm', w: '50mm' },
};

function itemHtml(it) {
  const tag = it.kind === 'combo' ? '<span class="tag">COMBO</span>' : '';
  const grupos = (it.grupos || []).map((g) => `
      <div class="ad-grp"><span class="ad-lbl">${esc(g.label)}:</span> ${esc((g.itens || []).join(', '))}</div>`).join('');
  const obs = it.obs ? `<div class="obs">OBS: ${esc(it.obs)}</div>` : '';
  return `
    <div class="item">
      <div class="item-top"><span class="qty">${esc(it.qty)}x</span> <span class="nome">${esc(it.nome)}</span>${tag}</div>
      ${grupos}
      ${obs}
    </div>`;
}

export function comandaHTML(vm, opts = {}) {
  const paper = PAPEis[opts.paper] || PAPEis['80mm'];
  const v = vm || {};
  const t = v.totais || {};
  const itensHtml = (v.itens || []).map(itemHtml).join('') || '<div class="item"><div class="item-top nome">—</div></div>';

  const enderecoBloco = v.endereco
    ? `<hr class="rule">
       <div class="sec-t">ENDEREÇO</div>
       ${(v.endereco.linhas || []).map((l) => `<div class="addr">${esc(l)}</div>`).join('') || '<div class="addr">—</div>'}`
    : '';

  const totalPedidos = Number.isFinite(v.cliente?.totalPedidos)
    ? `<div class="linha">Pedidos realizados: ${esc(v.cliente.totalPedidos)}</div>` : '';

  const ajuste = t.mostrarAjuste
    ? `<div class="tot-l"><span>${esc(t.deltaLabel)}</span><span>${t.delta < 0 ? '-' : ''}${esc(t.deltaFmt)}</span></div>` : '';

  const obsGeral = v.observacoes
    ? `<hr class="rule">
       <div class="sec-t">OBSERVAÇÕES</div>
       <div class="obs-geral">${esc(v.observacoes)}</div>` : '';

  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<style>
  @page { size: ${paper.page} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; color: #000; }
  .comanda {
    width: ${paper.w}; margin: 0 auto; padding: 4mm 3mm 6mm;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 13px; line-height: 1.3; color: #000; font-weight: 500;
    -webkit-font-smoothing: none;
  }
  .center { text-align: center; }
  .loja { font-size: 15px; font-weight: 800; letter-spacing: .3px; }
  .loja-sub { font-size: 11px; font-weight: 700; }
  .rule { border: none; border-top: 2px solid #000; margin: 7px 0; }
  .rule-thin { border: none; border-top: 1px solid #000; margin: 5px 0; }
  .tipo { display: inline-block; font-size: 18px; font-weight: 800; letter-spacing: 1.5px; padding: 3px 14px; border: 2.5px solid #000; border-radius: 3px; }
  .pedido { font-size: 23px; font-weight: 800; line-height: 1.05; margin-top: 7px; }
  .ref { font-size: 11px; font-weight: 700; margin-top: 1px; }
  .meta { font-size: 12.5px; font-weight: 600; }
  .meta b { font-weight: 800; }
  .sec-t { font-size: 12px; font-weight: 800; letter-spacing: 1px; margin: 9px 0 4px; padding-bottom: 2px; border-bottom: 1.5px solid #000; }
  .item { padding: 5px 0; }
  .item + .item { border-top: 1px dashed #000; }
  .item-top { font-size: 15px; }
  .qty { font-weight: 800; }
  .nome { font-weight: 800; }
  .tag { font-size: 10px; font-weight: 800; border: 1.5px solid #000; border-radius: 3px; padding: 0 4px; margin-left: 4px; }
  .ad-grp { font-size: 12.5px; padding-left: 12px; }
  .ad-lbl { font-weight: 800; }
  .obs { font-size: 12.5px; font-weight: 800; padding-left: 12px; margin-top: 2px; }
  .obs-geral { font-size: 13px; font-weight: 800; }
  .linha { font-size: 13px; font-weight: 600; }
  .addr { font-size: 14px; font-weight: 700; }
  .cobrar { display: inline-block; font-size: 13px; font-weight: 800; letter-spacing: .5px; margin-top: 5px; padding: 3px 12px; border: 2px solid #000; }
  .tot-l { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
  .tot-total { display: flex; justify-content: space-between; font-size: 19px; font-weight: 800; margin-top: 3px; }
  .rodape { font-size: 12px; font-weight: 600; margin-top: 8px; }
</style></head>
<body>
  <div class="comanda">
    <div class="center">
      <div class="loja">${esc(v.loja?.nome)}</div>
      <div class="loja-sub">${esc(v.loja?.linha2)}</div>
    </div>
    <hr class="rule">
    <div class="center"><span class="tipo">${esc(v.tipoLabel)}</span></div>
    <div class="center">
      <div class="pedido">Pedido ${esc(v.numero)}</div>
      ${v.refCurta ? `<div class="ref">Ref. cliente: ${esc(v.refCurta)}</div>` : ''}
    </div>
    <hr class="rule-thin">
    <div class="meta">Realizado: ${esc(v.criadoEm)}</div>
    <div class="meta">Previsão: <b>${esc(v.previsao)}</b></div>
    <hr class="rule">
    <div class="sec-t">ITENS</div>
    ${itensHtml}
    ${obsGeral}
    <hr class="rule">
    <div class="sec-t">CLIENTE</div>
    <div class="linha" style="font-weight:800">${esc(v.cliente?.nome)}</div>
    <div class="linha">${esc(v.cliente?.telefone)}</div>
    ${totalPedidos}
    ${enderecoBloco}
    <hr class="rule">
    <div class="sec-t">PAGAMENTO</div>
    <div class="linha" style="font-weight:800">${esc(v.pagamento?.forma)}</div>
    <div class="center"><span class="cobrar">COBRAR DO CLIENTE</span></div>
    <hr class="rule">
    <div class="tot-l"><span>Subtotal</span><span>${esc(t.subtotalFmt)}</span></div>
    ${ajuste}
    <div class="tot-total"><span>TOTAL</span><span>${esc(t.totalFmt)}</span></div>
    <hr class="rule">
    <div class="center rodape">
      <div>${esc(v.rodape)}</div>
      <div style="font-weight:800">Encanto Delivery</div>
    </div>
  </div>
</body></html>`;
}
