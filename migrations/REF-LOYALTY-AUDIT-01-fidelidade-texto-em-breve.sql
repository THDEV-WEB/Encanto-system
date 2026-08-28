-- REF-LOYALTY-AUDIT-01 — corrige o 3o paragrafo do default de company_info.fidelidadeTexto
-- ("Entre na sua conta para acompanhar seus selos em qualquer dispositivo (em breve).") que ainda
-- tratava como "em breve" uma funcionalidade que ja esta LIVE ha varias ondas (REF-CLIENTE-02/03:
-- Meus Pedidos/Fidelidade por conta, sincronizados entre dispositivos). Mesma classe de achado do
-- teaser "em breve" do chip fidelidade corrigido nesta sessao (StoreApp.jsx) — texto desatualizado
-- descrevendo como futuro algo que ja e real hoje.
--
-- get_company_info() e SQL puro (sem DML): o literal embutido na funcao E o default raiz servido a
-- QUALQUER loja que nunca tenha salvo fidelidadeTexto proprio em store_settings — inclusive a Encanto
-- hoje (confirmado: store_settings.valor da Encanto para chave='company_info' NAO tem a chave
-- fidelidadeTexto, entao get_company_info() resolve 100% pelo default abaixo). Corrigir aqui basta —
-- nao precisa de UPDATE em store_settings, o merge (default || stored) ja resolve pra Encanto e pra
-- qualquer loja futura sem override proprio.
--
-- Apenas o texto do 3o paragrafo muda; assinatura, demais campos do default e set_company_info
-- inalterados. Rollback em arquivo separado.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_company_info(p_store_id uuid DEFAULT public.default_store_id())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT
    '{"nomeCurto":"Encanto","nomeCompleto":"Encanto — Açaí & Marmitas","telefone":"5547992722920","whatsapp":"5547992722920","email":"contato@encantoacai.com.br","whatsappFloatEnabled":true,
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
        "Entre na sua conta para acompanhar seus selos em qualquer dispositivo."
      ]
     }'::jsonb
    || COALESCE((SELECT valor::jsonb FROM public.store_settings WHERE store_id = p_store_id AND chave = 'company_info' LIMIT 1), '{}'::jsonb);
$function$;

COMMIT;
