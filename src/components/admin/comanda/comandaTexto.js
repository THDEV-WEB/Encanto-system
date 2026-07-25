/* components/admin/comanda/comandaTexto.js — REF-REGRESSION-01 · P5.
   Gerador PURO do texto simples da comanda: view-model (buildComanda) -> string de texto plano,
   pronto para "Copiar" (área de transferência) e "Compartilhar via WhatsApp" (wa.me?text=).
   MESMO padrão de comandaHtml.js (renderer irmão do MESMO view-model, sem duplicar regra de
   negócio) — nunca lê `order` diretamente, só o objeto já construído por buildComanda(). Usa
   *asterisco* (negrito do WhatsApp) nos pontos de maior hierarquia, sem HTML/emoji de estilo. */

export function comandaTexto(vm) {
  const v = vm || {};
  const t = v.totais || {};
  const linhas = [];

  linhas.push(`*${v.loja?.nome || ''}*`);
  if (v.loja?.linha2) linhas.push(v.loja.linha2);
  linhas.push('');
  linhas.push(`*${v.tipoLabel || ''}* — Pedido ${v.numero || ''}`);
  if (v.refCurta) linhas.push(`Ref. cliente: ${v.refCurta}`);
  linhas.push(`Realizado: ${v.criadoEm || '—'}`);
  linhas.push(`Previsão: ${v.previsao || '—'}`);

  linhas.push('');
  linhas.push('*ITENS*');
  (v.itens || []).forEach((it) => {
    const tag = it.kind === 'combo' ? ' [COMBO]' : '';
    linhas.push(`${it.qty}x ${it.nome}${tag}`);
    (it.grupos || []).forEach((g) => linhas.push(`  ${g.label}: ${(g.itens || []).join(', ')}`));
    if (it.obs) linhas.push(`  OBS: ${it.obs}`);
  });

  if (v.observacoes) {
    linhas.push('');
    linhas.push('*OBSERVAÇÕES*');
    linhas.push(v.observacoes);
  }

  linhas.push('');
  linhas.push('*CLIENTE*');
  linhas.push(v.cliente?.nome || '—');
  linhas.push(v.cliente?.telefone || '—');
  if (Number.isFinite(v.cliente?.totalPedidos)) linhas.push(`Pedidos realizados: ${v.cliente.totalPedidos}`);

  if (v.endereco) {
    linhas.push('');
    linhas.push('*ENDEREÇO*');
    (v.endereco.linhas || []).forEach((l) => linhas.push(l));
  }

  linhas.push('');
  linhas.push('*PAGAMENTO*');
  linhas.push(v.pagamento?.forma || '—');
  linhas.push('COBRAR DO CLIENTE');

  linhas.push('');
  linhas.push(`Subtotal: ${t.subtotalFmt || ''}`);
  if (t.mostrarAjuste) linhas.push(`${t.deltaLabel}: ${t.delta < 0 ? '-' : ''}${t.deltaFmt}`);
  linhas.push(`*TOTAL: ${t.totalFmt || ''}*`);

  linhas.push('');
  linhas.push(v.rodape || '');
  linhas.push('Encanto Delivery');

  return linhas.join('\n');
}
