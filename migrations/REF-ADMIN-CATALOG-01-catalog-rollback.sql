-- ============================================================================
-- REF-ADMIN-CATALOG-01 — ROLLBACK
-- Restaura as 2 linhas duplicadas removidas (mesmos UUIDs e dados do snapshot da auditoria),
-- reverte categoria_ids/destaque das linhas mantidas e remove a coluna categoria_ids.
-- OBS: o repoint de order_items (dup -> mantido) NAO e revertido — apos a consolidacao nao ha
-- como saber quais itens eram originalmente do duplicado; o historico segue apontando para o
-- produto canonico sobrevivente (nome/preco identicos, sem perda). Rollback e best-effort do schema.
-- ============================================================================

-- Restaura Encanto Mineiro (c8 Destaques) — linha removida
insert into public.products (id, nome, descricao, categoria_id, destaque, disponivel, preco, preco_promo, ordem, adicionais_gratis, imagem_url)
values ('45e97133-6252-4cec-8b80-073d3a1ac676', 'Encanto Mineiro', 'Açaí cremoso • Doce de leite • Paçoca • Banana',
        'c8', true, true, 24.99, null, 2, 0,
        'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/encanto-mineiro.png')
on conflict (id) do nothing;

-- Restaura Marmita G 2 Proteinas (c2 Promocao do Dia) — linha removida
insert into public.products (id, nome, descricao, categoria_id, destaque, disponivel, preco, preco_promo, ordem, adicionais_gratis, imagem_url)
values ('94da9683-9b10-4a8b-a0fa-1d6406b55add', 'Marmita G 2 Proteínas com Açaí 500 ml', 'Promoção do dia',
        'c2', false, false, 49.99, null, 999, 0,
        'https://hvbcdxsagkjtfjwvnslo.supabase.co/storage/v1/object/public/products/marmita-g-2-proteinas-com-acai-500-ml.png')
on conflict (id) do nothing;

-- Reverte as linhas mantidas ao estado single-categoria anterior
update public.products set categoria_ids = array['c4'], destaque = false where id = 'cb7d5883-7b4b-44c0-8da0-d34722c6323b';
update public.products set categoria_ids = array['c1'] where id = 'bee7e771-f706-4eba-a570-9b4591bcbb72';

-- Remove a coluna (volta ao schema anterior)
alter table public.products drop column if exists categoria_ids;

notify pgrst, 'reload schema';
