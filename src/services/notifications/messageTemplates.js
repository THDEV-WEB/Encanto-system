/* services/notifications/messageTemplates.js — REF-ORDER-01 · Parte 3 (Notificacoes).
   FONTE UNICA E CANONICA das mensagens ao cliente. "Nao quero textos espalhados pelo sistema" (spec):
   toda copy de notificacao vive AQUI. Modulo PURO (sem React/IO/DOM) -> roda em Node (golden test).

   Fluxo de producao: cada troca de status enfileira uma notificacao (trigger -> notification_outbox) e a
   Edge Function `whatsapp-notify` RENDERIZA por estes MESMOS templates e envia pela WhatsApp Cloud API.
   A Edge Function mantem um espelho TS destes templates (supabase/functions/whatsapp-notify/templates.ts)
   — manter em sincronia; o snapshot em tests/whatsapp-templates.golden.mjs trava a copy canonica.

   Placeholders suportados: {{cliente}} {{numero}} {{tempo}}. */

export const NOTIFY_TEMPLATES = Object.freeze({
  recebido: `🍽️ Encanto Delivery

Olá, {{cliente}}.
Recebemos seu pedido #{{numero}}.
Agora nossa equipe iniciará o preparo.

Tempo estimado:
{{tempo}}

Obrigado pela preferência.`,

  preparo: `👨‍🍳 Encanto Delivery

Seu pedido #{{numero}}
já está sendo preparado.
Em breve seguirá para a próxima etapa.`,

  pronto: `✅ Encanto Delivery

Seu pedido #{{numero}}
está pronto.
Se for retirada, já pode ser buscado.
Se for entrega, nosso entregador sairá em instantes.`,

  entrega: `🛵 Encanto Delivery

Seu pedido #{{numero}}
acabou de sair para entrega.
Já está a caminho.`,

  entregue: `❤️ Encanto Delivery

Seu pedido foi entregue.
Esperamos que tenha gostado.
Muito obrigado pela preferência.`,
});

/* Estimativa de tempo por tipo — mesma copy da comanda/header (nao inventa numeros novos). */
export const TEMPO_ESTIMADO = Object.freeze({ entrega: '35 a 45 min', retirada: 'cerca de 20 min' });

/* Ha template (e portanto notificacao) para este status? 'cancelado' NAO tem template no spec -> sem envio. */
export const temTemplate = (status) => Object.prototype.hasOwnProperty.call(NOTIFY_TEMPLATES, status);

/* Renderiza o template do status substituindo os placeholders. PURO e tolerante:
   - status sem template -> retorna null (o chamador NAO envia nada);
   - placeholder sem valor correspondente -> vira string vazia (nunca deixa "{{x}}" cru).
   vars: { cliente?, numero?, tempo? } */
export function renderTemplate(status, vars = {}) {
  const tpl = NOTIFY_TEMPLATES[status];
  if (!tpl) return null;
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, chave) => {
    const v = vars[chave];
    return v == null ? '' : String(v);
  });
}
