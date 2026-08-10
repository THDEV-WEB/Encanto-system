-- REF-SAAS-01 · Onda 7.1 — WhatsApp operacional multi-tenant (wa.me, SEM Meta Cloud API/Tech Provider/
-- BSP/webhooks — proibicao explicita do dono nesta subfase).
--
-- CONTEXTO: company_info.whatsapp JA E por loja desde a Onda 6.2 (store_settings) e todos os 5 pontos
-- de consumo no cliente (StoreApp.jsx, SuccessPage.jsx, ContatoScreen.jsx, AdminFidelidade.jsx) JA leem
-- esse campo dinamicamente. O gap real estava no JSON literal de defaults de get_company_info(): uma
-- loja nova (sem nenhuma linha propria em store_settings) herdava silenciosamente nomeCurto="Encanto",
-- telefone/whatsapp="5547992722920" — o numero e a identidade REAIS da Encanto. Esta migration troca
-- SO esses 6 campos (identidade/contato) para valores neutros/vazios ("Loja", "", false) — nunca mais
-- um dado real de outra loja. Os demais campos (paleta, Termos, Fidelidade — cosmeticos, ja avaliados
-- na Onda 6.2) permanecem intocados.
--
-- Byte-identico para a Encanto: sua linha em store_settings ja tem os 6 campos salvos explicitamente
-- (confirmado por leitura direta antes desta migration) — o merge (||) nunca alcanca o default para
-- ela. Sem DROP FUNCTION: a assinatura (p_store_id uuid DEFAULT default_store_id()) nao muda.
--
-- Requer REF-SAAS-01-onda6-2-branding-por-loja.sql (ja aplicada). Rollback em arquivo separado.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_info(p_store_id uuid DEFAULT public.default_store_id())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nomeCurto":"Loja","nomeCompleto":"Loja","telefone":"","whatsapp":"","email":"","whatsappFloatEnabled":false,
      "corPrimaria":"#A62786","corSecundaria":"#6B1F5D","corDestaque":"#FFBF00",
      "termosSecoes":[
        {"titulo":"Uso do serviço","corpo":"Ao realizar um pedido você concorda com as condições de compra, prazos de entrega e formas de pagamento informadas no checkout."},
        {"titulo":"Privacidade","corpo":"Coletamos apenas os dados necessários para processar o seu pedido (nome, contato e endereço). Não compartilhamos seus dados com terceiros sem necessidade operacional."},
        {"titulo":"Cancelamento e trocas","corpo":"Pedidos em preparo podem ter regras específicas de cancelamento. Em caso de problemas, fale conosco pelo WhatsApp."},
        {"titulo":"Contato","corpo":"Dúvidas sobre estes termos podem ser tratadas pelos nossos canais de contato."}
      ],
      "fidelidadeTexto":[
        "A cada pedido você acumula um selo no seu cartão de fidelidade.",
        "Ao completar a cartela, você ganha um benefício especial no próximo pedido.",
        "Entre na sua conta para acompanhar seus selos em qualquer dispositivo (em breve)."
      ]
     }'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
