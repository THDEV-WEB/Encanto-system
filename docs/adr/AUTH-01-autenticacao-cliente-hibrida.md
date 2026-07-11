# AUTH-01 — Autenticação de cliente em modo híbrido (guest-first)

**Status:** IMPLEMENTADA no código (Ondas 0–3, 2026-07-11) · **aplicação das migrations e provider SMS = passos manuais pendentes** (ver §Ativação).
**Depende de:** NORM-06.1 (RLS do catálogo), HARDEN-ORDERS-RLS (checkout via `create_order` SECURITY DEFINER).
**Relacionado:** REQ-01 (telefone válido), PEND-PHONE-SSOT (unificação da normalização de telefone), REF-APP-01 (arquitetura em camadas).

## Contexto

A loja precisa de **contas opcionais** para o cliente, sem obstruir a compra. Dois fatos condicionam o desenho:
1. O **Admin já usa Supabase Auth** (`db.auth.signInWithPassword`) e as policies de escrita do catálogo (NORM-06.1) liberam para **qualquer `authenticated`**, sob a premissa "signups desabilitados ⇒ `authenticated` == admin". Habilitar login de cliente via Supabase Auth **quebra essa premissa** → escalada de privilégio.
2. O cliente é identificado pelo **telefone** (`customers.phone` único; `create_order` faz upsert por telefone). Contas devem **vincular** ao `customer` existente, nunca duplicar.

## Decisão

- **Guest-first:** visitante e cliente logado usam a MESMA loja; o checkout de visitante permanece byte-idêntico (`create_order` intocado). Login é camada de valor, nunca bloqueio.
- **Duas instâncias Supabase, sessões isoladas:** `db` (dados/admin) e **`dbCliente`** (cliente, `storageKey: 'encanto-cliente-auth'`). Admin e cliente nunca se deslogam mutuamente.
- **Phone OTP** como método (identidade = telefone = chave do `customer`).
- **`admins` (tabela) = fonte da verdade administrativa** + `is_admin()` (SECURITY DEFINER). Policies de escrita do catálogo endurecidas de `TO authenticated USING(true)` → `USING(is_admin())`. Cliente autenticado comum **não** edita catálogo.
- **Vínculo por telefone idempotente** via RPC `link_customer_to_auth` (SECURITY DEFINER): reduz E.164 (55+DDD+número) → formato local do checkout, casa com o `customer` histórico; cria só se realmente não existir. Pedidos antigos passam à conta pelo mesmo `customer_id`, sem migração de dados.
- **Camadas React no lugar certo:** `lib/dbCliente` · `services/AuthService` · `contexts/AuthContext` · `providers/AuthProvider` (envolve **só a loja**) · `hooks/useAuth` · `components/auth/*`. **App.jsx** ganha 1 linha (wrap de `<StoreApp>`); Admin fica fora do provider → isolado. Sem novo router/`mode`.

## Alternativas descartadas

- **Reusar `db`/sessão única** — quebra a independência Admin×Cliente (uma sessão só). ❌
- **`app_metadata.role='admin'`** — reprovado: banco = fonte da verdade → tabela `admins`. ❌
- **Login por e-mail/magic-link** — cria identidade paralela ao telefone (a chave canônica). ❌
- **Tabela `profiles` como fonte primária** — duplicaria a chave telefone já canônica em `customers`. ❌
- **Login obrigatório** — viola a regra de negócio. ❌
- **Prefill/histórico no checkout agora** — adiaria ondas; a fase 1 **não toca** o checkout. ⏳ (ondas futuras)

## Consequências

- **+** contas escaláveis (base para histórico/favoritos/fidelidade/cashback/cupons), zero risco ao checkout de visitante, isolamento total do Admin, sem duplicação de clientes.
- **−** +1 coluna (`customers.auth_user_id`), +tabela `admins`, +`is_admin()`, +RPC, +policies; requer **provedor SMS** (custo) e **registro do admin** antes do endurecimento.
- **Débito:** PEND-PHONE-SSOT (a redução E.164→local vive na RPC como paliativo; unificar a normalização telefone frontend↔backend no futuro).

## Ativação (passos MANUAIS — não automatizados por segurança)

1. Aplicar `migrations/AUTH-01-step1-fundacao.sql` (aditivo, não-breaking).
2. Registrar o admin: `INSERT INTO public.admins(user_id) SELECT id FROM auth.users WHERE email='<admin>';` e validar `SELECT public.is_admin();` (logado como admin ⇒ true).
3. Aplicar `migrations/AUTH-01-step2-harden-rls.sql` (BREAKING; só após o passo 2). Auditar `pg_policies` antes.
4. Supabase → Auth: habilitar **Phone provider** (SMS) e signup de cliente.
5. Rodar `npm run test:auth-rls` (deve ficar GREEN).

## Rollback

- Código: `git revert` das Ondas 0–3 (frontend é aditivo; `App.jsx` volta a `<StoreApp/>` sem provider).
- Banco: `AUTH-01-step2-harden-rls-rollback.sql` (restaura escrita `authenticated`) e `AUTH-01-step1-fundacao-rollback.sql` (remove tabela/funções/policies; coluna preservada por padrão).

## Gates por onda

| Onda | Entrega | Gate |
|---|---|---|
| 0 | migrations + `test:auth-rls` | build/test:deps verdes; **test:auth-rls** (após aplicar): anon lê/não escreve; cliente não-admin **não** escreve catálogo; admin escreve; leitura própria isolada; guest checkout intacto |
| 1 | `dbCliente`/`AuthService`/`AuthContext`/`AuthProvider`/`useAuth` + wrap | 7/7 gates; Admin inalterado; loja de visitante idêntica |
| 2 | `components/auth/*` + `AuthButton` no header | 7/7; guest nunca bloqueado; login/logout OK |
| 3 | vínculo por telefone no login | 7/7; sem duplicação; pedidos antigos reatam pelo `customer_id` |
