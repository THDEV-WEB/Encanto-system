# REF-AUTH-TENANT-01 — Tenant verificável no JWT

17 ago 2026. Auditoria + arquitetura proposta. Zero implementação. Espelho do artifact publicado na
sessão. Aprovado pelo dono como "Caminho 2" da revisão de [[REF-ADDRESS-SEC-02]] — tratar a causa raiz
na arquitetura de autenticação em vez de mitigar em `addresses` isoladamente.

## Achado de pesquisa que definiu o desenho

Confirmei via documentação oficial do Supabase (não presumido) que o Custom Access Token Hook recebe
**só** `user_id`, claims atuais e `authentication_method` — nunca headers HTTP, Origin, Referer, nem
dado extra que o app queira passar. Isso descarta a ideia óbvia ("hook decide o tenant pelo domínio")
e levou ao desenho real: **ativar o tenant é um passo explícito e verificado, separado do login,** cujo
resultado o Hook só assina depois.

## Desenho

1. Login normal — token emitido sem `tenant_id` ainda (Hook é no-op se não achar nada).
2. App resolve a loja pelo domínio (como já faz hoje, `get_store_by_domain`) — continua sendo só hint
   de UX.
3. App chama `activate_tenant(p_store_id)` — SECURITY DEFINER, verifica de verdade
   `EXISTS(customers WHERE auth_user_id=auth.uid() AND store_id=p_store_id) AND stores.status='ativo'`.
   Se válido, grava em `public.active_tenant(auth_user_id, store_id)` (tabela nova, 1 linha por pessoa).
4. App força `refreshSession()` — dispara o Hook de novo.
5. Hook lê `active_tenant` e embute `claims.tenant_id` — assinado, imutável pelo client a partir daqui.
6. Toda RLS/RPC passa a ler `(auth.jwt()->>'tenant_id')::uuid` — nunca mais um parâmetro cru.

**Por que fecha o teste do curl**: uma vez que o token tem `tenant_id=Encanto` assinado, nenhuma
manipulação de parâmetro em chamadas subsequentes muda isso. A única forma de obter acesso à Bar da
Sogra é chamar `activate_tenant('bar-uuid')` de verdade — o que só sucede se a pessoa REALMENTE for
cliente de lá — seguido de refresh. Nesse ponto não é mais ataque, é troca legítima.

## Admin/Super Admin — preservados por desenho

Recomendação: **não** dar claim de tenant ao Admin. `is_admin_of(p_store_id)` já é correto para o que
o Admin precisa (gerenciar várias lojas na mesma sessão é o comportamento pretendido, não uma falha).
O Hook precisa ser um no-op seguro quando não há linha em `active_tenant` (login de admin).

## Staleness — registrado sem meio-termo escondido

Perder acesso a uma loja não é revogação instantânea — token já emitido continua valendo até expirar
(~1h padrão) ou renovar. É limitação inerente de qualquer JWT de vida curta, não um descuido desta
REF.

## Risco não verificado

Não confirmei se o plano/tier atual do projeto Supabase suporta Custom Access Token Hook (token da
Management API local expirado). Precisa checar no Dashboard antes de aprovar a implementação.

## Plano de 7 ondas

Infraestrutura (tabela + Hook) → `activate_tenant` + wiring no boot → `link_customer_to_auth` →
RLS de `addresses` → `save_structured_address` + RPC de leitura → testes de ataque (5 casos) →
regressão completa. Cada onda com gate próprio de aprovação.

SQL preliminar (conceitual, não a versão final) no artifact. Aguardando aprovação do desenho antes de
qualquer implementação.

## Gate final — auditoria de `activate_tenant()` (2ª rodada)

Dono confirmou: Custom Access Token Hook disponível no Free e Pro do Supabase — não precisa migrar de
plano.

**Achado de concorrência que corrigiu o desenho**: a 1ª versão usava `auth_user_id` como chave
primária de `active_tenant` (1 linha por pessoa, global). Isso quebra o cenário de 2 abas em lojas
diferentes (mesma pessoa): a 2ª ativação sobrescreveria a 1ª, e no próximo refresh silencioso da 1ª
aba ela perderia o próprio tenant sem pedir. **Corrigido**: as claims padrão do Supabase já incluem
`session_id` (confirmado na pesquisa da 1ª rodada) — cada login tem o seu, e como cada loja é um
domínio separado (localStorage isolado por origem, já é assim hoje), abas em lojas diferentes têm
`session_id` diferentes. `active_tenant` passa a ser chaveada por `session_id`
(`REFERENCES auth.sessions(id) ON DELETE CASCADE` — confirmei que `auth.sessions` existe de verdade
no projeto), não mais por pessoa — isolamento correto entre abas/sessões, limpeza automática no
logout.

**`activate_tenant()` auditada nos 16 pontos pedidos**: SECURITY DEFINER (mesmo padrão de
`save_structured_address`), só `authenticated`, mesma verificação `EXISTS(customers+stores ativa)`
já validada nas REFs anteriores, sem distinguir "loja não existe" de "loja inativa" na mensagem de
erro (evita dar pista pra quem testa IDs por tentativa e erro). Achado incidental: não há UNIQUE
constraint em `customers(auth_user_id, store_id)` — não afeta `activate_tenant` (EXISTS não precisa
de linha única), registrado como hardening futuro, fora do escopo crítico.

**Hook fail-closed confirmado linha por linha**: reconfirma `stores.status='ativo'` a CADA refresh
(não só na ativação) — se a loja for desativada depois, o claim some no próximo refresh, nunca emite
valor inválido.

**RLS conceitual demonstrada**: `store_id = (auth.jwt()->>'tenant_id')::uuid AND customer_id IN
(customers do auth.uid() nesse mesmo tenant)` — teste definitivo (6 tentativas: leitura direta,
parâmetro manipulado, RPC manipulada, curl, e finalmente ativação legítima seguida de troca) percorrido
passo a passo, todas resolvendo como especificado.

Zero implementação nesta rodada também. Aguardando aprovação final do dono.
