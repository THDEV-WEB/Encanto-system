-- REF-SEC-DATA-01 — Rodada 3: R9 (pg_net EXECUTE amplo), R18 (bucket products sem limite),
-- R19 (3 funcoes sem migration versionada). Achados menores da auditoria de protecao de dados de
-- clientes (2026-08-17), corrigidos com autorizacao do dono. R4/R10/R11 ficam fora (REF-AUTH-TENANT-01,
-- conduzida em sessao separada). R15/R16 sao informativos, sem correcao.
--
-- ACHADO R9: anon e authenticated tem EXECUTE real em net.http_get/net.http_post (confirmado via
-- has_function_privilege, nao so ACL nula — extensoes concedem EXECUTE a PUBLIC por padrao ao criar
-- cada funcao). Nao e exploravel pela API REST hoje (schema net nao e exposto pelo PostgREST, so
-- public) mas e grant desnecessario, mesmo padrao ja corrigido em R1-R3/R8. Confirmado por introspecao
-- que as UNICAS funcoes que chamam net.* sao enc_dispatch_notifications e send_alert — ambas
-- SECURITY DEFINER de dono postgres, chamadas via pg_cron como postgres (cron.job.username='postgres'
-- nos 4 jobs) — revogar de anon/authenticated nao quebra nada real (SECURITY DEFINER roda com os
-- privilegios do DONO, nunca do caller, pra qualquer objeto tocado por dentro da funcao).
--
-- ACHADO R18: bucket 'products' com file_size_limit=NULL e allowed_mime_types=NULL (sem limite/
-- whitelist no servidor). Politicas de storage.objects confirmadas: upload/update/delete ja exigem
-- is_admin_of(store_id) — nao e aberto a qualquer authenticated, e um hardening de defesa em
-- profundidade (admin comprometido ou bug no client nao fica livre pra subir arquivo arbitrario).
-- Valores espelham EXATAMENTE a validacao ja existente no client (src/components/admin/
-- ImageUploader.jsx:33-36): 5MB, image/jpeg+png+webp+gif.
--
-- ACHADO R19: get_setting/normalize_phone/send_alert existem em producao mas NUNCA tiveram
-- CREATE FUNCTION versionado nos 138 arquivos de migrations/ do repo (confirmado por grep exaustivo) —
-- provavelmente criadas via SQL Editor antes da disciplina de migration do projeto. Corpo capturado
-- via pg_get_functiondef AGORA, reproduzido aqui byte a byte — ZERO mudanca de comportamento, so fecha
-- o gap de reprodutibilidade (se o banco precisasse ser reconstruido so a partir de migrations/, essas
-- 3 funcoes faltariam). send_alert ja tem EXECUTE corretamente restrito a postgres/service_role
-- (confirmado); get_setting/normalize_phone sao read-only/puras, sem risco de seguranca, so
-- documentacao faltando.
--
-- NAO ALTERADO: nenhuma logica de negocio, nenhuma policy de RLS, nenhuma tabela de dados de cliente.
--
-- Companion: REF-SEC-DATA-01-harden-r9-r18-r19-rollback.sql

BEGIN;

-- 1) R9 — revogar EXECUTE de anon/authenticated em TODAS as funcoes do schema net (pg_net).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.sig);
  END LOOP;
END $$;

-- 2) R18 — bucket 'products': espelha no servidor a validacao que o client ja faz.
UPDATE storage.buckets
   SET file_size_limit = 5242880,  -- 5 MB, mesmo teto de ImageUploader.jsx:33
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif']
 WHERE id = 'products';

-- 3) R19 — captura "as-built" das 3 funcoes sem migration previa. Corpo identico ao que ja roda hoje.
CREATE OR REPLACE FUNCTION public.get_setting(p_chave text, p_default text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce((select valor from public.settings where chave=p_chave), p_default);
$function$;

CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(
           case when left(d,2)='55' and length(d) in (12,13) then substr(d,3) else d end,
           ''
         )
  from (select regexp_replace(coalesce(p,''), '\D', '', 'g') as d) s;
$function$;

CREATE OR REPLACE FUNCTION public.send_alert(p_module text, p_message text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_url text := public.get_setting('alert_webhook_url',''); v_body jsonb;
begin
  insert into public.application_logs(module,operation,level,message,payload,version,origin)
    values(coalesce(p_module,'alert'),'send_alert','alert',p_message,p_payload,'harden-07','cron');
  if v_url is not null and v_url <> '' and exists (select 1 from pg_extension where extname='pg_net') then
    v_body := jsonb_build_object('source','encanto','module',p_module,'message',p_message,'payload',p_payload,'at',now());
    begin
      execute format('select net.http_post(url := %L, body := %L::jsonb, headers := %L::jsonb)',
                     v_url, v_body::text, '{"Content-Type":"application/json"}');
    exception when others then
      insert into public.application_logs(module,operation,level,message,version,origin)
        values('alert','webhook','error','falha ao enviar webhook: '||sqlerrm,'harden-07','cron');
    end;
  end if;
end;$function$;

-- send_alert e' SECURITY DEFINER — o CREATE OR REPLACE acima reseta grants pro padrao (owner postgres
-- so). Reconfirma explicitamente o estado ja correto de producao (nenhuma mudanca real, so blindagem
-- contra o CREATE OR REPLACE silenciosamente abrir o que ja estava fechado).
REVOKE ALL ON FUNCTION public.send_alert(text, text, jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;

-- Verificacao pos-aplicacao (rodar manualmente, ou via scripts/sec-data-01-r9-r18-r19-test.mjs):
-- SELECT has_function_privilege('anon', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'EXECUTE');
--   -- deve vir FALSE (authenticated tambem)
-- SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='products';
--   -- deve vir 5242880 / {image/jpeg,image/png,image/webp,image/gif}
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND proname IN ('get_setting','normalize_phone','send_alert');
--   -- as 3 devem existir com o MESMO pg_get_functiondef de antes (zero mudanca de comportamento)
