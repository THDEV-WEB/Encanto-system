// supabase/functions/whatsapp-notify/templates.ts — REF-ORDER-01 · Parte 3.
// ESPELHO (server, Deno/TS) do modulo canonico src/services/notifications/messageTemplates.js.
// MANTER EM SINCRONIA: a copy canonica e o .js do frontend; o snapshot em
// tests/whatsapp-templates.golden.mjs trava o texto. Este arquivo existe porque a Edge Function roda em
// Deno e nao importa o bundle do browser. Ao editar mensagens, edite AMBOS e rode o golden.

export const NOTIFY_TEMPLATES: Record<string, string> = {
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
};

export function renderTemplate(status: string, vars: Record<string, unknown> = {}): string | null {
  const tpl = NOTIFY_TEMPLATES[status];
  if (!tpl) return null;
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, chave: string) => {
    const v = vars[chave];
    return v == null ? "" : String(v);
  });
}
