/* e2e/support/fixture-accounts.js — REF-E2E-01 · Onda 4.
   Credenciais das 2 contas fixture do projeto Supabase DEDICADO a E2E (nunca produção). Fonte única
   — usada tanto pelo script de setup (scripts/e2e-fixture-accounts.mjs, que as cria via Admin API)
   quanto pelos helpers/specs que precisam logar como elas (authSession.js, admin/*.spec.js). */
export const CLIENTE_FIXTURE = Object.freeze({
  email: 'e2e-cliente@teste.encanto.local',
  senha: 'e2e-fixture-nao-usar-em-prod-9f2b',
  nome: 'Cliente E2E',
  telefone: '47999990000',
});

export const ADMIN_FIXTURE = Object.freeze({
  email: 'e2e-admin@teste.encanto.local',
  senha: 'e2e-fixture-admin-nao-usar-em-prod-4c7d',
});

/* REF-SAAS-01 · Onda 8 (correcao pos-onda): pessoa DISTINTA de ADMIN_FIXTURE -- usada para provar
   isolamento entre 2 admins REAIS e diferentes (nao o Super Admin se auto-vinculando a uma 2a loja,
   que e um teste mais fraco). Persistente como os demais fixtures (nunca apagada, so seus vinculos
   transacionais). */
export const ADMIN_B_FIXTURE = Object.freeze({
  email: 'e2e-admin-b@teste.encanto.local',
  senha: 'e2e-fixture-admin-b-nao-usar-em-prod-7f1a',
});
