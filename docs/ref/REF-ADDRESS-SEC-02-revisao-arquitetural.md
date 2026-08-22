# REF-ADDRESS-SEC-02 — Revisão arquitetural (fronteira de tenant)

17 ago 2026. Somente análise — zero migration, zero código alterado. Espelho do artifact publicado
na sessão. Responde à rejeição da proposta RPC-only anterior: o dono exigiu uma resposta real para
"como o backend sabe qual tenant a sessão está usando, sem confiar num store_id enviado pelo
navegador", com o critério de aprovação explícito: mesmo `auth.uid()`, duas lojas, client alterando
`p_store_id` → CROSS-TENANT = DENY, mesmo para dados legítimos da própria pessoa.

## Conclusão central

**Nenhuma correção só em `addresses` fecha esse critério por completo.** Rastreei todas as opções
disponíveis (Origin/Host real, contexto de sessão server-side, JWT claim via Auth Hook, tabela de
mapping, RPC-only reforçada, restringir 1 pessoa a 1 tenant) e só uma — **Custom Access Token Hook
(claim de loja assinado no JWT)** — resiste a um atacante deliberado usando ferramentas de linha de
comando com credenciais válidas. Todas as demais dependem, em algum ponto, do header `Origin`, que o
navegador protege mas uma ferramenta como `curl` não é obrigada a respeitar.

## Por que o precedente do Admin (`is_admin_of`) não resolve o mesmo problema

`is_admin_of(p_store_id)` funciona porque, para o Admin, "ter acesso à loja X" nunca dependeu de estar
navegando no domínio de X — um admin gerencia várias lojas do MESMO painel, trocando de loja num
seletor, e isso é o comportamento pretendido. Para o storefront, a pergunta é diferente: "ver o
histórico da Bar da Sogra" deveria depender de genuinamente estar interagindo com o site da Bar da
Sogra — e não existe, hoje, o equivalente de uma tabela `admins` para isso: só existe "pessoa P tem
conta na loja Y" (fato permanente), nunca "sessão S está autenticada especificamente para a loja Y
agora".

## Achado (Fase 6): `link_customer_to_auth` é a raiz do problema

Essa RPC (que cria/vincula `customers.auth_user_id`) recebe `p_store_id` puro do client e usa direto
para decidir em qual loja criar/atualizar o cadastro — é por isso que `customers.store_id` (que seria
a âncora óbvia) também não é confiável na origem. Documentado, não corrigido (mesma raiz do problema
principal; se resolver via Caminho 2 abaixo, se beneficia automaticamente).

## Dois caminhos apresentados, nenhum escolhido unilateralmente

1. **Mitigação forte, escopo pequeno** — RPC-only (já desenhada na proposta anterior) reforçada com
   verificação de `Origin` numa Edge Function dedicada. Fecha contra uso normal da aplicação e contra
   JS malicioso injetado na página legítima (XSS). Risco residual documentado explicitamente: não
   fecha contra alguém tecnicamente sofisticado forjando `Origin` via ferramentas de linha de comando.
   Continua sendo `REF-ADDRESS-SEC-02`.
2. **Correção completa** — Custom Access Token Hook: claim de loja assinado no JWT, trocar de loja
   exige novo token/refresh forçado. Responde exatamente ao critério definido, mas é mudança de
   arquitetura de AUTENTICAÇÃO da plataforma inteira (não só endereços) — recomendo `REF-AUTH-TENANT-01`
   separada. Fase 7 do artifact detalha as 10 perguntas (como o claim é definido/alterado/emitido, troca
   de loja, logout, dual-tenant, staleness, impacto Admin/Super Admin).

## Estado

`REF-ADDRESS-UX-01` permanece **NÃO fechada**. Aguardando decisão do dono sobre qual caminho seguir
(ou se aceita o risco residual do Caminho 1 documentado, ou investe no Caminho 2).

## Fechamento (20 ago 2026)

O Caminho 2 (Custom Access Token Hook) foi aprovado e implementado numa REF separada,
`REF-AUTH-TENANT-01` — ver `docs/ref/REF-AUTH-TENANT-01-auditoria.md`. Hook + migração de RLS/RPC de
`addresses` (Onda 5) + `link_customer_to_auth` (Onda 6) estão ao vivo em produção desde 19 ago 2026.

Reverifiquei o critério de aprovação exato desta REF (mesmo `auth.uid()`, duas lojas, `p_store_id`/
tenant manipulado → DENY mesmo para dado legítimo da própria pessoa) com um teste direto contra
produção (transação `BEGIN...ROLLBACK`, dado fictício, revertido ao final, nada persistido): sessão
com `tenant_id` da loja errada não enxerga o endereço da outra loja (0 linhas); a mesma sessão com
`tenant_id` correto enxerga normalmente; sessão sem `tenant_id` (pré-ativação) é negada (fail-closed);
outra pessoa com `tenant_id` correto continua sem ver o endereço alheio. As 4 policies de `addresses`
(SELECT/INSERT/UPDATE/DELETE) e as funções `save_structured_address`/`link_customer_to_auth` já usam
`auth.jwt()->>'tenant_id'` — nunca mais um parâmetro vindo do client.

**REF-ADDRESS-SEC-02 = FECHADA.** Nenhum código/migration desta REF foi aplicado — o achado foi
resolvido como efeito da arquitetura da `REF-AUTH-TENANT-01`. `REF-ADDRESS-UX-01` fica liberada para
fechamento (ver `docs/ref/REF-ADDRESS-UX-01-auditoria.md`).
