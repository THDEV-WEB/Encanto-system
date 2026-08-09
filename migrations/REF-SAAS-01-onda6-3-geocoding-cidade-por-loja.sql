-- REF-SAAS-01 · Onda 6.3 — Geocoding sem cidade fixa: semeia company_info.cidade/estado da Encanto.
--
-- CONTEXTO: nominatimService.js/addressFormat.js/coordinates.js tinham "Timbó"/"SC" hardcoded como
-- vies de busca/fallback/centro de mapa. Esta subfase remove esse hardcode do CODIGO, passando a ler
-- company_info.cidade/estado (endereco institucional, ja por loja desde a Onda 6.2, ja administravel
-- em "Central de Configuracao da Empresa" sem nenhum campo novo). Mas a migracao da Onda 6.2 preservou
-- SO o que ja estava salvo em producao — e cidade/estado NUNCA foram salvos pela Encanto (confirmado
-- por leitura direta: a linha real so tinha email/lojaLat/lojaLng/telefone/whatsapp/nomeCurto/
-- nomeCompleto/whatsappFloatEnabled). Sem este seed, o codigo generalizado desta subfase faria a
-- Encanto perder o vies de busca "Timbó, SC" que ja funciona hoje e o cabecalho da loja ficaria sem
-- cidade — regressao real. Este UPDATE fecha essa lacuna, byte-idêntico ao que a Encanto ja tinha
-- hardcoded ate agora (mesma cidade, mesma UF).
--
-- Idempotente: so aplica o merge se cidade/estado ainda NAO estiverem presentes (nunca sobrescreve uma
-- edicao real que o Admin ja tenha feito entre a Onda 6.2 e esta subfase). Sem RPC/schema novo — merge
-- raso direto no jsonb, mesma tecnica que set_company_info faria.
--
-- Requer REF-SAAS-01-onda6-2-branding-por-loja.sql (ja aplicada). Rollback em arquivo separado.

BEGIN;

UPDATE public.store_settings
SET valor = (valor::jsonb || jsonb_build_object('cidade', 'Timbó', 'estado', 'SC'))::text
WHERE store_id = (SELECT id FROM public.stores WHERE slug = 'encanto')
  AND chave = 'company_info'
  AND NOT (COALESCE(valor::jsonb->>'cidade', '') <> '' OR COALESCE(valor::jsonb->>'estado', '') <> '');

COMMIT;
