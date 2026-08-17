-- REF-AUTH-TENANT-01 — Onda 1: fundação (tabela active_tenant)
--
-- Contexto: hoje o Supabase Auth deste projeto emite UM TOKEN POR PESSOA, não por
-- (pessoa, loja). RLS/RPC só enxergam auth.uid() — não existe, em lugar nenhum do
-- backend, um sinal verificado de "qual loja esta sessão está usando agora". Esta REF
-- fecha essa lacuna: cada SESSÃO ativa uma loja explicitamente (Onda 2), e o Custom
-- Access Token Hook (Onda 3) assina isso como claim `tenant_id` no JWT — dali em diante
-- toda RLS/RPC lê o claim assinado, nunca mais um p_store_id cru vindo do client.
--
-- Esta migration cria SÓ a tabela de apoio. Nenhuma RPC, nenhum Hook, nenhuma policy de
-- addresses/customers muda aqui — isso são as próximas ondas, cada uma com seu próprio
-- gate de aprovação.
--
-- Por que chaveada por session_id (não por auth_user_id):
-- a mesma pessoa pode legitimamente ter uma aba aberta na Encanto e outra na Bar da
-- Sogra ao mesmo tempo (2 domínios = 2 sessões distintas, isolamento de origem nativo
-- do browser). Se a chave fosse auth_user_id (1 linha por pessoa), a 2ª ativação
-- sobrescreveria a 1ª e uma aba perderia o próprio tenant silenciosamente no próximo
-- refresh em background. session_id evita essa disputa: cada sessão tem sua própria
-- linha, FK real para auth.sessions(id) (confirmado que existe, coluna id uuid PK).
--
-- Por que a coluna se chama store_id e não tenant_id: toda tabela do schema (customers,
-- addresses, admins) já usa store_id como identificador de loja/tenant — manter o mesmo
-- nome aqui evita introduzir um segundo conceito para a mesma coisa. O claim assinado no
-- JWT (Onda 3) SIM se chamará `tenant_id` (nome já acordado com o dono nas auditorias
-- anteriores) — é só o nome externo da claim, não da coluna interna.
--
-- Grants: authenticated fica SEM nenhum privilégio direto nesta tabela (nem SELECT).
-- Todo acesso passa por função SECURITY DEFINER (activate_tenant, Onda 2) ou pelo Hook
-- (supabase_auth_admin, Onda 3 — grant dele vem só quando o Hook existir, não antes).
-- Confirmado nesta sessão que tabelas novas em public herdam grant total automático
-- para authenticated neste projeto — por isso o REVOKE explícito abaixo não é
-- redundante, é a única coisa que impede acesso direto.

BEGIN;

CREATE TABLE public.active_tenant (
  session_id   uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store_id     uuid NOT NULL REFERENCES public.stores(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.active_tenant IS
  'REF-AUTH-TENANT-01: loja ativada para a sessão atual. 1 linha por session_id (nao por pessoa) para permitir abas simultaneas em lojas diferentes. Escrita exclusiva via activate_tenant() (Onda 2); leitura exclusiva via Custom Access Token Hook (Onda 3). authenticated nao tem privilegio direto.';

-- Suporta o CASCADE de auth.users e eventuais consultas futuras "sessoes ativas desta
-- pessoa" sem depender de índice não-existente na FK.
CREATE INDEX active_tenant_auth_user_id_idx ON public.active_tenant (auth_user_id);

ALTER TABLE public.active_tenant ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy é criada de propósito: RLS ligada + zero policies = deny-all para
-- qualquer role sujeita a RLS. postgres (dono, usado pelas funções SECURITY DEFINER)
-- tem rolbypassrls=true e continua acessando normalmente.
REVOKE ALL ON public.active_tenant FROM authenticated;
REVOKE ALL ON public.active_tenant FROM anon;

COMMIT;
