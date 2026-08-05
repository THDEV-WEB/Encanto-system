-- REF-GOLIVE-01 (bloqueador 2/2) — tempo de entrega: fonte UNICA tambem no envio automatico de WhatsApp.
--
-- CONTEXTO: a auditoria tecnica pre-Go-Live (relatorio de 05/08/2026) encontrou o tempo de entrega
-- hardcoded ("35 a 45 min") em TRES copias independentes: src/services/notifications/messageTemplates.js
-- (TEMPO_ESTIMADO), src/components/admin/comanda/comandaModel.js (PREVISAO) — ambas corrigidas no mesmo
-- commit de codigo desta REF, ver docs/adr/REF-GOLIVE-01-*.md — e esta funcao SQL abaixo,
-- enc_tempo_estimado() (migrations/REF-ORDER-01-order-ops.sql), a copia mais critica das tres: alimenta
-- o placeholder {{tempo}} de enc_enqueue_notification, consumido pelos DOIS dispatchers de notificacao
-- (enc_render_message via pg_cron — o caminho realmente ativo em producao — e a Edge Function
-- whatsapp-notify, que le o MESMO vars.tempo snapshotado na fila). Sem esta migration, o cliente
-- continuaria recebendo "35 a 45 min" na notificacao automatica de "recebido" mesmo depois do Admin
-- mudar o tempo de entrega — exatamente a divergencia que REF-DELIVERY-01 foi criada para eliminar.
--
-- FIX: enc_tempo_estimado() passa a ler o MESMO valor administravel usado pelo resto do app
-- (settings.delivery_eta_min, REF-DELIVERY-01/01a) via get_setting() — seguro aqui porque a funcao so e
-- chamada de dentro de enc_enqueue_notification (SECURITY DEFINER), o mesmo padrao ja usado pelas
-- funcoes de fidelidade (loyalty_required/loyalty_enabled/loyalty_discount, REF-LOYALTY-01) para ler
-- settings sem tropecar na RLS trancada da tabela (licao registrada na REF-DELIVERY-01a: get_setting só
-- funciona server-side, dentro de outra funcao SECURITY DEFINER — nunca chamado direto do browser).
-- Retirada permanece constante de negocio (nao administravel, fora de escopo desta REF): "cerca de 20
-- min", textualmente igual a sempre, em todas as copias (SQL/JS).
--
-- IMMUTABLE -> STABLE: a funcao agora le uma tabela que pode mudar (settings) — IMMUTABLE seria
-- semanticamente incorreto (o otimizador poderia assumir que o retorno nunca muda dentro de uma sessao,
-- cacheando/constant-fold um valor que na verdade muda quando o Admin salva um novo tempo de entrega).
--
-- Requer REF-ORDER-01-order-ops.sql e REF-DELIVERY-01-delivery-eta-rpc.sql (ja aplicadas).
-- Idempotente (CREATE OR REPLACE). Rollback em arquivo separado. Aplicacao MANUAL via Supabase SQL editor
-- (mesmo procedimento de todas as migrations anteriores deste projeto).

BEGIN;

CREATE OR REPLACE FUNCTION public.enc_tempo_estimado(p_address text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_address ~* 'retirada\s+na\s+loja' THEN 'cerca de 20 min'
    ELSE 'até ' || public.get_setting('delivery_eta_min', '45') || ' min'
  END;
$$;

COMMIT;
