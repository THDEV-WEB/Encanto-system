/* hooks/useMinhaConta.js — REF-CLIENTE-03 (Area "Minha Conta"). Encapsula a LOGICA de edicao de perfil
   do cliente logado: validacao + chamada das acoes do AuthProvider + mapeamento amigavel de erros.
   O estado dos inputs (controlados) fica na tela; aqui ficam os valores iniciais + os salvadores.
   Vinculo SEGURO: as escritas passam por link_customer_to_auth (auth.uid()) e auth.updateUser — o
   cliente nunca escreve direto em customers; sempre o MESMO customer (id/auth_user_id preservados). */
import { useAuth } from './useAuth.js';

const soDigitos = (s) => (s || '').replace(/\D/g, '');
const emailValido = (e) => /.+@.+\..+/.test((e || '').trim());

export function useMinhaConta() {
  const { user, customer, atualizarPerfil, atualizarEmail, excluirMeusDados, exportarMeusDados } = useAuth();

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

  /* REF-LGPD-01 · Onda 1 (LGPD-R01): exclusao/anonimizacao dos proprios dados. A confirmacao ja e'
     exigida na tela (2 passos) antes de chamar isto -- aqui so mapeia erro tecnico pra mensagem amigavel. */
  const excluirDados = async () => {
    const r = await excluirMeusDados();
    if (r?.error) return { ok: false, msg: 'Não foi possível concluir agora. Tente novamente em instantes.' };
    if (r?.data?.ok === false) return { ok: false, msg: r.data.error || 'Não foi possível concluir.' };
    return { ok: true, msg: 'Seus dados foram removidos.' };
  };

  /* REF-LGPD-01 · Onda 2 (LGPD-R03): portabilidade. O download em si (Blob/<a>) fica na tela, que e'
     onde DOM/browser API pertencem -- aqui so' busca o JSON e mapeia erro. */
  const baixarDados = async () => {
    const r = await exportarMeusDados();
    if (r?.error) return { ok: false, msg: 'Não foi possível gerar o arquivo agora. Tente novamente.' };
    return { ok: true, dados: r.data };
  };

  return {
    nomeInicial: customer?.name || '',
    telefoneInicial: customer?.phone || '',
    email: user?.email || '',
    criadoEm: user?.created_at || customer?.created_at || null,
    temCadastro: !!customer?.id,
    salvarPerfil,
    salvarEmail,
    excluirDados,
    baixarDados,
  };
}
