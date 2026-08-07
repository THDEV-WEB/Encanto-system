-- REF-SAAS-01 · Onda 0 — Fundacao multi-tenant: tabela `stores` + `store_id` nullable
-- ADR de referencia: docs/adr/REF-SAAS-01-fundacao-multitenant.md (§1.2 Store, §6 Estrategia de
-- isolamento de dados, §9 Convencoes para novas tabelas).
--
-- Escopo desta migration (e SO este):
--   1. Cria `public.stores` (raiz de todo o particionamento futuro).
--   2. Insere a loja "encanto" (Cliente Zero) como primeira e unica linha.
--   3. Adiciona `store_id uuid NULLABLE REFERENCES stores(id)` em toda tabela de dado de
--      NEGOCIO de uma loja (13 tabelas — ver lista abaixo).
--   4. Backfill: 100% das linhas existentes apontam para "encanto" (unica loja hoje).
--   5. Indice por `store_id` em cada tabela (preparacao para as Ondas 2/4 filtrarem por loja
--      sem custo de performance).
--
-- Explicitamente FORA de escopo desta onda (decisao registrada no ADR, nao esquecimento):
--   - `admins.store_id`      -> Onda 1 (gateway de autorizacao, junto de super_admins/is_admin_of).
--   - `settings`/`store_settings` -> Onda 4 (migracao das chaves de config por loja).
--   - `address_gazetteer`    -> permanece GLOBAL de proposito (dado geografico de referencia,
--                               compartilhavel entre lojas da mesma cidade — ADR §6).
--   - Nenhuma coluna `store_id` fica NOT NULL nesta onda; nenhuma RLS/policy nova; nenhuma RPC
--     tocada. Isso e 100% aditivo e retrocompativel — a Encanto Marmitaria continua funcionando
--     identicamente, porque nada em `src/` ainda le/escreve `store_id`.
--
-- Tabelas que recebem store_id nesta onda: customers, products, categories, adicionais,
-- product_collections, orders, order_items, order_events, loyalty_accounts, loyalty_events,
-- notification_outbox, addresses, application_logs (nullable/opcional, so p/ filtro futuro de
-- observabilidade — ADR §6).

BEGIN;

CREATE TABLE public.stores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  nome        text NOT NULL,
  dominio     text UNIQUE,
  status      text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','suspenso','cancelado')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS habilitado desde o primeiro commit (ADR §9.2) — sem nenhuma policy ainda (mesmo padrao ja
-- usado em `settings`: tabela trancada, so RPCs SECURITY DEFINER acessam). Policies reais entram
-- na Onda 1, quando `super_admins`/`is_admin_of()` existirem.
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

INSERT INTO public.stores (slug, nome, dominio, status)
VALUES ('encanto', 'Encanto — Açaí & Marmitas', 'encanto.valionsistemas.com.br', 'ativo');

ALTER TABLE public.customers            ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.products             ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.categories           ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.adicionais           ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.product_collections  ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.orders               ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.order_items          ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.order_events         ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.loyalty_accounts     ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.loyalty_events       ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.notification_outbox  ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.addresses            ADD COLUMN store_id uuid REFERENCES public.stores(id);
ALTER TABLE public.application_logs     ADD COLUMN store_id uuid REFERENCES public.stores(id);

-- Backfill: volume atual e pequeno (poucas centenas de linhas no total, ver relatorio da onda),
-- uma unica transacao e seguro. Todas as linhas existentes pertencem a "encanto" (unica loja hoje).
DO $$
DECLARE v_store_id uuid;
BEGIN
  SELECT id INTO v_store_id FROM public.stores WHERE slug = 'encanto';

  UPDATE public.customers           SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.products            SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.categories          SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.adicionais          SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.product_collections SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.orders              SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.order_items         SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.order_events        SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.loyalty_accounts    SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.loyalty_events      SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.notification_outbox SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.addresses           SET store_id = v_store_id WHERE store_id IS NULL;
  UPDATE public.application_logs    SET store_id = v_store_id WHERE store_id IS NULL;
END $$;

CREATE INDEX customers_store_id_idx           ON public.customers (store_id);
CREATE INDEX products_store_id_idx            ON public.products (store_id);
CREATE INDEX categories_store_id_idx          ON public.categories (store_id);
CREATE INDEX adicionais_store_id_idx          ON public.adicionais (store_id);
CREATE INDEX product_collections_store_id_idx ON public.product_collections (store_id);
CREATE INDEX orders_store_id_idx              ON public.orders (store_id);
CREATE INDEX order_items_store_id_idx         ON public.order_items (store_id);
CREATE INDEX order_events_store_id_idx        ON public.order_events (store_id);
CREATE INDEX loyalty_accounts_store_id_idx    ON public.loyalty_accounts (store_id);
CREATE INDEX loyalty_events_store_id_idx      ON public.loyalty_events (store_id);
CREATE INDEX notification_outbox_store_id_idx ON public.notification_outbox (store_id);
CREATE INDEX addresses_store_id_idx           ON public.addresses (store_id);
CREATE INDEX application_logs_store_id_idx    ON public.application_logs (store_id);

COMMIT;
