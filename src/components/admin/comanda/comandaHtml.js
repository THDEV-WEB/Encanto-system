/* components/admin/comanda/comandaHtml.js — REF-ORDER-01 · Parte 1.
   Gerador PURO do documento da comanda: view-model (buildComanda) -> string HTML autocontida
   (estilo embutido). Sem React, sem DOM, sem IO — roda em Node (golden test) e serve tanto ao
   preview (iframe srcDoc) quanto a impressao (iframe oculto). FONTE UNICA de layout/estilo da comanda:
   preview e impressao usam EXATAMENTE este HTML (WYSIWYG), 100% desacoplado do index.css do app.

   Impressora termica: `@page{margin:0}` + largura em mm (80mm padrao / 58mm opcional) + alto contraste
   (preto no branco, sem cor de fundo que gaste ribbon) + fonte robusta. Preparado para futuras
   impressoras: o mesmo view-model pode alimentar um encoder ESC/POS sem tocar nesta camada. */

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
      <div class="ad-grp">
        <span class="ad-lbl">${esc(g.label)}:</span>
        <span class="ad-itens">${esc((g.itens || []).join(', '))}</span>
      </div>`).join('');
  const obs = it.obs ? `<div class="obs">OBS: ${esc(it.obs)}</div>` : '';
  return `
    <div class="item">
      <div class="item-top"><span class="qty">${esc(it.qty)}x</span> <span class="nome">${esc(it.nome)}</span> ${tag}</div>
      ${grupos}
      ${obs}
    </div>`;
}

export function comandaHTML(vm, opts = {}) {
  const paper = PAPEis[opts.paper] || PAPEis['80mm'];
  const v = vm || {};
  const t = v.totais || {};
  const itensHtml = (v.itens || []).map(itemHtml).join('') || '<div class="item"><div class="nome">—</div></div>';

  const enderecoBloco = v.endereco
    ? `<div class="sec">
         <div class="sec-t">ENDEREÇO</div>
         ${(v.endereco.linhas || []).map((l) => `<div class="linha">${esc(l)}</div>`).join('') || '<div class="linha">—</div>'}
       </div>`
    : '';

  const totalPedidos = Number.isFinite(v.cliente?.totalPedidos)
    ? `<div class="linha muted">Pedidos realizados: ${esc(v.cliente.totalPedidos)}</div>` : '';

  const ajuste = t.mostrarAjuste
    ? `<div class="tot-l"><span>${esc(t.deltaLabel)}</span><span>${t.delta < 0 ? '-' : ''}${esc(t.deltaFmt)}</span></div>` : '';

  const obsGeral = v.observacoes
    ? `<div class="sec"><div class="sec-t">OBSERVAÇÕES</div><div class="linha">${esc(v.observacoes)}</div></div>` : '';

  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<style>
  @page { size: ${paper.page} auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; color: #000; }
  .comanda {
    width: ${paper.w}; margin: 0 auto; padding: 4mm 2mm 6mm;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px; line-height: 1.35; color: #000;
    -webkit-font-smoothing: none;
  }
  .center { text-align: center; }
  .loja { font-size: 17px; font-weight: 800; letter-spacing: .5px; }
  .loja-sub { font-size: 11px; font-weight: 600; margin-bottom: 2px; }
  .hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  .hr-solid { border: none; border-top: 2px solid #000; margin: 6px 0; }
  .tipo { font-size: 20px; font-weight: 800; letter-spacing: 2px; padding: 4px 0; border: 2px solid #000; border-radius: 4px; }
  .meta { font-size: 12px; font-weight: 600; }
  .meta .num { font-size: 15px; font-weight: 800; }
  .meta .ref { font-size: 11px; color: #333; }
  .sec-t { font-size: 11px; font-weight: 800; letter-spacing: 1px; margin: 4px 0 2px; }
  .sec { margin-top: 2px; }
  .item { padding: 4px 0; border-bottom: 1px dotted #999; }
  .item:last-child { border-bottom: none; }
  .item-top { font-size: 13px; }
  .qty { font-weight: 800; }
  .nome { font-weight: 700; }
  .tag { font-size: 9px; font-weight: 800; border: 1px solid #000; border-radius: 3px; padding: 0 3px; vertical-align: middle; }
  .ad-grp { font-size: 11px; padding-left: 10px; }
  .ad-lbl { font-weight: 700; }
  .obs { font-size: 11px; font-weight: 700; padding-left: 10px; margin-top: 1px; }
  .linha { font-size: 12px; }
  .muted { color: #333; }
  .tot-l { display: flex; justify-content: space-between; font-size: 12px; }
  .tot-total { display: flex; justify-content: space-between; font-size: 16px; font-weight: 800; margin-top: 2px; }
  .rodape { font-size: 11px; margin-top: 6px; }
</style></head>
<body>
  <div class="comanda">
    <div class="center">
      <div class="loja">${esc(v.loja?.nome)}</div>
      <div class="loja-sub">${esc(v.loja?.linha2)}</div>
    </div>
    <hr class="hr-solid">
    <div class="center"><div class="tipo">${esc(v.tipoLabel)}</div></div>
    <hr class="hr">
    <div class="meta">
      <div class="num">Pedido ${esc(v.numero)}</div>
      ${v.refCurta ? `<div class="ref">Ref. cliente: ${esc(v.refCurta)}</div>` : ''}
      <div>Realizado: ${esc(v.criadoEm)}</div>
      <div>Previsão: ${esc(v.previsao)}</div>
    </div>
    <hr class="hr">
    <div class="sec-t">ITENS</div>
    ${itensHtml}
    ${obsGeral}
    <hr class="hr">
    <div class="sec">
      <div class="sec-t">CLIENTE</div>
      <div class="linha">${esc(v.cliente?.nome)}</div>
      <div class="linha">${esc(v.cliente?.telefone)}</div>
      ${totalPedidos}
    </div>
    ${enderecoBloco}
    <hr class="hr">
    <div class="sec">
      <div class="sec-t">PAGAMENTO</div>
      <div class="linha">${esc(v.pagamento?.forma)}</div>
    </div>
    <hr class="hr">
    <div class="tot-l"><span>Subtotal</span><span>${esc(t.subtotalFmt)}</span></div>
    ${ajuste}
    <div class="tot-total"><span>TOTAL</span><span>${esc(t.totalFmt)}</span></div>
    <hr class="hr-solid">
    <div class="center rodape">
      <div>${esc(v.rodape)}</div>
      <div style="font-weight:700">Encanto Delivery</div>
    </div>
  </div>
</body></html>`;
}
