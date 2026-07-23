/* e2e/support/fixture-customer.js — REF-E2E-02.
   Garante que o cliente fixture (authSession.js) tem uma linha public.customers VINCULADA e com
   telefone (identidade), com nome/telefone no BASELINE conhecido (CLIENTE_FIXTURE). Sem isso,
   `precisaTelefone` fica `true` na 1ª carga (AuthProvider.jsx) e o modal "Complete seu cadastro"
   (CompletarCadastro.jsx) aparece automaticamente por cima de QUALQUER tela — descoberto ao rodar
   session-restore.spec.js pela 1ª vez contra o backend real: o overlay do modal intercepta o clique
   no topo do drawer, mesmo em specs de sessão "puros" que não têm nada a ver com Minha Conta. Por isso
   este helper entra já na Onda 2 (o plano original da auditoria previa Onda 3 — ajustado ao rodar).
   Idempotente: chama a MESMA RPC híbrida (link_customer_to_auth) que a UI usa, sempre com os valores
   baseline — seguro rodar em toda spec/describe que precise do cliente "já cadastrado". Não usa
   service_role: loga como o próprio fixture (signInWithPassword), então passa pela RLS/RPC como um
   cliente real completando o cadastro — não um atalho privilegiado. */
import { supabaseAnon, E2E_ENV_PRONTO, avisarAmbientePendente } from './supabaseAdmin.js';
import { CLIENTE_FIXTURE } from './fixture-accounts.js';

/** Garante (idempotente) que o cliente fixture está vinculado com nome/telefone baseline.
    {ok:false, skipped:true} se o ambiente de E2E não estiver configurado (no-op, mesmo padrão do
    resto de support/*.js). Lança se o próprio backend recusar (erro real, não deveria acontecer com
    o baseline). */
export async function garantirClienteFixtureVinculado() {
  if (!E2E_ENV_PRONTO) { avisarAmbientePendente('vínculo do cliente fixture'); return { ok: false, skipped: true }; }
  const anon = supabaseAnon();
  const { data: sessao, error: erroLogin } = await anon.auth.signInWithPassword({
    email: CLIENTE_FIXTURE.email, password: CLIENTE_FIXTURE.senha,
  });
  if (erroLogin || !sessao?.session) throw new Error(`[e2e] login do cliente fixture falhou: ${erroLogin?.message || 'sem sessão'}`);
  const { data, error } = await anon.rpc('link_customer_to_auth', {
    p_phone: CLIENTE_FIXTURE.telefone, p_email: CLIENTE_FIXTURE.email, p_name: CLIENTE_FIXTURE.nome,
  });
  await anon.auth.signOut();   // client anon é compartilhado (singleton) — não deixa sessão presa nele
  if (error) throw new Error(`[e2e] link_customer_to_auth do fixture falhou: ${error.message}`);
  if (data?.ok === false) throw new Error(`[e2e] link_customer_to_auth do fixture recusado: ${data.error}`);
  return { ok: true, skipped: false, customerId: data.customer_id };
}
