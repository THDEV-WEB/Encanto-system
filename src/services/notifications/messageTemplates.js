/* services/notifications/messageTemplates.js — REF-ORDER-01 · Parte 3 (Notificacoes).
   FONTE UNICA E CANONICA das mensagens ao cliente. "Nao quero textos espalhados pelo sistema" (spec):
   toda copy de notificacao vive AQUI. Modulo PURO (sem React/IO/DOM) -> roda em Node (golden test).

   Fluxo de producao: cada troca de status enfileira uma notificacao (trigger -> notification_outbox) e a
   Edge Function `whatsapp-notify` RENDERIZA por estes MESMOS templates e envia pela WhatsApp Cloud API.
   A Edge Function mantem um espelho TS destes templates (supabase/functions/whatsapp-notify/templates.ts)
   — manter em sincronia; o snapshot em tests/whatsapp-templates.golden.mjs trava a copy canonica.

   Placeholders suportados: {{cliente}} {{numero}} {{tempo}} {{empresa}}.
   REF-COMPANY-02: {{empresa}} vem do NOME CURTO institucional (settings.company_info.nomeCurto),
   snapshotado no enqueue (enc_enqueue_notification) — mesmo modelo de frescor ja usado para
   cliente/numero/tempo (ver ADR REF-COMPANY-02 §Decisao B: staleness aceitavel, sem busca ao vivo
   duplicada nos dois runtimes de disparo).

   REF-GOLIVE-01 (bloqueador 2): {{tempo}} NAO tem mais uma constante local aqui (TEMPO_ESTIMADO foi
   removida) — quem enfileira a notificacao decide o valor. No servidor (caminho real de producao) e a
   funcao SQL enc_tempo_estimado(), corrigida para ler settings.delivery_eta_min; no preview do Admin
   (PedidoNotificacoes.jsx) e services/delivery/deliveryEtaFormat.js:textoTempoEntrega. As tres fontes do
   tempo (SQL, preview JS, comanda) agora leem o MESMO numero configurado pelo Admin. */

export const NOTIFY_TEMPLATES = Object.freeze({
  recebido: `🍽️ {{empresa}}

Olá, {{cliente}}.
Recebemos seu pedido #{{numero}}.
Agora nossa equipe iniciará o preparo.

Tempo estimado:
{{tempo}}

Obrigado pela preferência.`,

  preparo: `👨‍🍳 {{empresa}}

Seu pedido #{{numero}}
já está sendo preparado.
Em breve seguirá para a próxima etapa.`,

  pronto: `✅ {{empresa}}

Seu pedido #{{numero}}
está pronto.
Se for retirada, já pode ser buscado.
Se for entrega, nosso entregador sairá em instantes.`,

  entrega: `🛵 {{empresa}}

Seu pedido #{{numero}}
acabou de sair para entrega.
Já está a caminho.`,

  entregue: `❤️ {{empresa}}

Seu pedido foi entregue.
Esperamos que tenha gostado.
Muito obrigado pela preferência.`,
});

/* Ha template (e portanto notificacao) para este status? 'cancelado' NAO tem template no spec -> sem envio. */
export const temTemplate = (status) => Object.prototype.hasOwnProperty.call(NOTIFY_TEMPLATES, status);

/* Renderiza o template do status substituindo os placeholders. PURO e tolerante:
   - status sem template -> retorna null (o chamador NAO envia nada);
   - placeholder sem valor correspondente -> vira string vazia (nunca deixa "{{x}}" cru).
   vars: { cliente?, numero?, tempo?, empresa? } */
export function renderTemplate(status, vars = {}) {
  const tpl = NOTIFY_TEMPLATES[status];
  if (!tpl) return null;
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave) => {
    const v = vars[chave];
    return v == null ? '' : String(v);
  });
}
