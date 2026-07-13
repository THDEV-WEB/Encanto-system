/* hooks/useMinhaConta.js — REF-CLIENTE-03 (Area "Minha Conta"). Encapsula a LOGICA de edicao de perfil
   do cliente logado: validacao + chamada das acoes do AuthProvider + mapeamento amigavel de erros.
   O estado dos inputs (controlados) fica na tela; aqui ficam os valores iniciais + os salvadores.
   Vinculo SEGURO: as escritas passam por link_customer_to_auth (auth.uid()) e auth.updateUser — o
   cliente nunca escreve direto em customers; sempre o MESMO customer (id/auth_user_id preservados). */
import { useAuth } from './useAuth.js';

const soDigitos = (s) => (s || '').replace(/\D/g, '');
const emailValido = (e) => /.+@.+\..+/.test((e || '').trim());

export function useMinhaConta() {
  const { user, customer, atualizarPerfil, atualizarEmail } = useAuth();

  /* Salva nome + telefone no MESMO customer (nao cria novo; preserva pedidos/historico/vinculo). */
  const salvarPerfil = async (nome, telefone) => {
    const n = (nome || '').trim();
    if (!n) return { ok: false, msg: 'Informe seu nome.' };
    if (soDigitos(telefone).length < 10) return { ok: false, msg: 'Informe um telefone com DDD (mínimo 10 dígitos).' };
    const r = await atualizarPerfil(n, telefone);
    const appErr = r?.error?.message || (r?.data?.ok === false ? r.data.error : null);
    if (appErr) {
      if (/outra conta/i.test(appErr)) return { ok: false, msg: 'Este telefone já está vinculado a outra conta.' };
      if (/invalid|invalido/i.test(appErr)) return { ok: false, msg: 'Telefone inválido. Verifique o DDD e o número.' };
      return { ok: false, msg: 'Não foi possível salvar. Tente outro número ou tente novamente.' };
    }
    return { ok: true, msg: 'Perfil atualizado com sucesso.' };
  };

  /* Troca de e-mail pelo fluxo oficial do Supabase (confirmacao). So efetiva apos o usuario confirmar. */
  const salvarEmail = async (email) => {
    const e = (email || '').trim().toLowerCase();
    if (!emailValido(e)) return { ok: false, msg: 'Digite um e-mail válido.' };
    if (e === (user?.email || '').trim().toLowerCase()) return { ok: false, msg: 'Este já é o seu e-mail atual.' };
    const r = await atualizarEmail(e);
    if (r?.error) {
      const m = r.error.message || '';
      if (/already|registered|exists|in use|em uso/i.test(m)) return { ok: false, msg: 'Este e-mail já está em uso por outra conta.' };
      return { ok: false, msg: 'Não foi possível iniciar a troca de e-mail. Tente novamente.' };
    }
    return { ok: true, pendente: true, msg: `Enviamos um link de confirmação para ${e}. Confirme por lá para concluir a troca.` };
  };

  return {
    nomeInicial: customer?.name || '',
    telefoneInicial: customer?.phone || '',
    email: user?.email || '',
    criadoEm: user?.created_at || customer?.created_at || null,
    temCadastro: !!customer?.id,
    salvarPerfil,
    salvarEmail,
  };
}
