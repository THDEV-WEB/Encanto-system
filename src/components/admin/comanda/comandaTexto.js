/* components/admin/comanda/comandaTexto.js — REF-REGRESSION-01 · P5 (+ REF-CHECKOUT-02/03).
   Gerador PURO do texto simples da comanda: view-model (buildComanda) -> string de texto plano,
   pronto para "Copiar" (área de transferência) e "Compartilhar via WhatsApp" (wa.me?text=).
   MESMO padrão de comandaHtml.js (renderer irmão do MESMO view-model, sem duplicar regra de
   negócio) — nunca lê `order` diretamente, só o objeto já construído por buildComanda(). Usa
   *asterisco* (negrito do WhatsApp) nos pontos de maior hierarquia, sem HTML/emoji de estilo.

   opts.contexto ('interna' default | 'cliente') escolhe o RENDERER — dois layouts bem diferentes
   sobre o MESMO view-model (nenhuma duplicação de regra de negócio, só de apresentação):
     - 'interna' (default): documento operacional da cozinha/Admin — comandaTextoInterna, ZERO
       mudança de comportamento desde a REF-ORDER-01 (golden prova byte-a-byte).
     - 'cliente' (REF-CHECKOUT-03): mensagem automática do WhatsApp que o cliente recebe/confirma —
       comandaTextoCliente, layout comercial (cabeçalho PARA ENTREGA/RETIRADA, nome comercial,
       numeroCurto sem hash, sem Ref. cliente/IDs internos, troco sempre explícito). */

function comandaTextoInterna(v, t) {
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
  if (v.pagamento?.troco) linhas.push(`Troco para: ${v.pagamento.troco}`);
  linhas.push('COBRAR DO CLIENTE');

  linhas.push('');
  linhas.push(`Subtotal: ${t.subtotalFmt || ''}`);
  if (t.mostrarEntrega) linhas.push(`Entrega: ${t.entregaFmt}`);
  if (t.mostrarMaquininha) linhas.push(`Retorno maquininha: ${t.maquininhaFmt}`);
  if (t.mostrarAjuste) linhas.push(`${t.deltaLabel}: ${t.delta < 0 ? '-' : ''}${t.deltaFmt}`);
  linhas.push(`*TOTAL: ${t.totalFmt || ''}*`);

  linhas.push('');
  linhas.push(v.rodape || '');
  linhas.push(v.loja?.nomeFooter || '');

  return linhas.join('\n');
}

/* REF-CHECKOUT-03: layout comercial da mensagem automática do WhatsApp — ver o mock/imagem de
   referência anexado ao pedido. Reaproveita 100% os dados do view-model (nenhum recálculo); só
   escolhe outros campos (numeroCurto em vez de numero, tipoLabelCliente em vez de tipoLabel,
   loja.nomeComercial em vez de loja.nome/linha2) e outra ordem/hierarquia de blocos.
   Diferenças deliberadas em relação à comanda interna:
     - sem "Ref. cliente" (código técnico sem utilidade para quem recebe a própria mensagem);
     - REF-DELIVERY-FEE-01: entrega/maquininha (campos explícitos, ver comandaModel) aparecem igual à
       comanda interna — só o "ajuste" genérico (delta residual não explicado) continua suprimido
       quando positivo, mostrando só quando é desconto (mesmo motivo de sempre: nunca expor um número
       "adivinhado" ao cliente);
     - troco SEMPRE aparece (explícito "Não precisa" quando ausente, em vez de omitir a linha);
     - "COBRAR DO CLIENTE" mantido (quem LÊ a mensagem é a loja — o cliente só toca em Enviar). */
function comandaTextoCliente(v, t) {
  const linhas = [];

  linhas.push(`*${v.tipoLabelCliente || v.tipoLabel || ''}*`);
  linhas.push('');
  linhas.push(v.criadoEm ? v.criadoEm.replace(', ', ' ') : '—');
  linhas.push(`${v.previsaoLabel || 'Previsão'}: ${v.previsao || '—'}`);
  linhas.push(v.loja?.nomeComercial || v.loja?.nomeFooter || '');

  linhas.push('');
  linhas.push(`*Pedido ${v.numeroCurto || '—'}*`);

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
  linhas.push('Nome:');
  linhas.push(v.cliente?.nome || '—');
  linhas.push('Telefone:');
  linhas.push(v.cliente?.telefone || '—');
  if (v.endereco) {
    linhas.push('Entrega:');
    (v.endereco.linhas || []).forEach((l) => linhas.push(l));
  }

  linhas.push('');
  linhas.push('*PAGAMENTO*');
  linhas.push('Forma de Pagamento:');
  linhas.push(v.pagamento?.forma || '—');
  linhas.push('');
  linhas.push('*Cobrar do cliente*');

  linhas.push('');
  linhas.push(`Subtotal: ${t.subtotalFmt || ''}`);
  if (t.mostrarEntrega) linhas.push(`Entrega: ${t.entregaFmt}`);
  if (t.mostrarMaquininha) linhas.push(`Retorno da maquininha: ${t.maquininhaFmt}`);
  /* Ajuste residual (delta não explicado por item/entrega/maquininha) — só desconto, quando aplicável. */
  if (t.mostrarAjuste && t.delta < 0) linhas.push(`Desconto: ${t.deltaFmt}`);
  linhas.push(`*TOTAL: ${t.totalFmt || ''}*`);
  linhas.push(v.pagamento?.troco ? `Troco para: ${v.pagamento.troco}` : 'Troco: Não precisa');

  linhas.push('');
  linhas.push(v.loja?.nomeComercial || v.loja?.nomeFooter || '');

  return linhas.join('\n');
}

export function comandaTexto(vm, opts = {}) {
  const v = vm || {};
  const t = v.totais || {};
  return opts.contexto === 'cliente' ? comandaTextoCliente(v, t) : comandaTextoInterna(v, t);
}
