/* components/conta/MinhaContaScreen.jsx — REF-CLIENTE-03 (Area "Minha Conta").
   Gerenciamento profissional da conta do cliente logado: ver dados (nome, e-mail, telefone, membro
   desde) e EDITAR nome/telefone (mesmo customer, sem quebrar pedidos/historico/vinculo) e e-mail
   (fluxo oficial do Supabase, por confirmacao). Estados: carregando/salvando/erro/sucesso + toasts.
   Vinculo SEGURO: escreve via link_customer_to_auth (auth.uid()) e auth.updateUser — nunca em customers
   direto; RLS/auth.uid() garantem que ninguem edita dados de outro. Separada de "Meus pedidos". */
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { useMinhaConta } from '../../hooks/useMinhaConta.js';
import { ScreenModal } from '../menu/ScreenModal.jsx';
import { Toast } from '../ui/Toast.jsx';
import { nomeExibicao, inicialExibicao, avatarUrlDe, telefoneExibicao } from '../menu/userDisplay.js';
import { fmtDate } from '../../utils/format.js';

const soDigitos = (s) => (s || '').replace(/\D/g, '');

const label = { fontSize: 12.5, fontWeight: 700, color: 'var(--gray-500)', display: 'block', marginBottom: 5 };
const sec = { borderTop: '1px solid var(--gray-100)', paddingTop: 16, marginTop: 16 };
const secTitle = { fontSize: 14, fontWeight: 800, color: 'var(--gray-800)', marginBottom: 12 };
const roleta = { fontSize: 13.5, color: 'var(--gray-700)' };
const primary = { width: '100%', marginTop: 12, padding: '11px', borderRadius: 12, border: 'none', background: 'var(--grape)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
const ghost = { width: '100%', marginTop: 10, padding: '11px', borderRadius: 12, border: '1px solid var(--gray-300)', background: 'var(--white)', color: 'var(--grape)', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
const aviso = { fontSize: 14, color: 'var(--gray-500)', textAlign: 'center', padding: '28px 12px', lineHeight: 1.5 };
const dado = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', fontSize: 13.5 };

export function MinhaContaScreen({ onClose }) {
  const { isLogged, user, customer } = useAuth();
  const mc = useMinhaConta();

  const [nome, setNome] = useState(mc.nomeInicial);
  const [telefone, setTelefone] = useState(mc.telefoneInicial);
  const [novoEmail, setNovoEmail] = useState('');
  const [savingPerfil, setSavingPerfil] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailPendente, setEmailPendente] = useState(false);
  const [toast, setToast] = useState(null); // { tipo, msg }

  /* Sincroniza os valores iniciais quando o customer termina de carregar — SO em campos ainda intactos
     (nao sobrescreve o que o usuario ja digitou). Cobre a restauracao de sessao pos-login. */
  useEffect(() => {
    setNome((n) => (n ? n : mc.nomeInicial));
    setTelefone((t) => (t ? t : mc.telefoneInicial));
  }, [mc.nomeInicial, mc.telefoneInicial]);

  if (!isLogged) {
    return (
      <ScreenModal title="Minha conta" onClose={onClose}>
        <p style={aviso}>Entre na sua conta para gerenciar seus dados. 🔑</p>
      </ScreenModal>
    );
  }

  const nomeHeader = nomeExibicao(customer, user);
  const avatarUrl = avatarUrlDe(user);
  const telFormatado = telefoneExibicao({ phone: telefone });
  const perfilAlterado =
    nome.trim() !== (mc.nomeInicial || '').trim() || soDigitos(telefone) !== soDigitos(mc.telefoneInicial);

  const salvarPerfil = async () => {
    if (savingPerfil || !perfilAlterado) return;
    setSavingPerfil(true);
    const r = await mc.salvarPerfil(nome, telefone);
    setSavingPerfil(false);
    setToast({ tipo: r.ok ? 'sucesso' : 'erro', msg: r.msg });
  };

  const enviarTrocaEmail = async () => {
    if (savingEmail) return;
    setSavingEmail(true);
    const r = await mc.salvarEmail(novoEmail);
    setSavingEmail(false);
    setToast({ tipo: r.ok ? 'sucesso' : 'erro', msg: r.msg });
    if (r.ok) { setEmailPendente(true); setNovoEmail(''); }
  };

  return (
    <ScreenModal title="Minha conta" onClose={onClose}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 4 }}>
        {avatarUrl
          ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          : <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--grape)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22, flexShrink: 0 }}>{inicialExibicao(nomeHeader)}</span>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nomeHeader}</div>
          {user?.email && <div style={{ fontSize: 13, color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>}
        </div>
      </div>

      {/* Resumo dos dados */}
      <div style={sec}>
        <div style={secTitle}>Dados da conta</div>
        <div style={dado}><span style={roleta}>E-mail</span><strong style={{ fontSize: 13, textAlign: 'right', wordBreak: 'break-all' }}>{mc.email || '—'}</strong></div>
        <div style={dado}><span style={roleta}>Telefone</span><strong style={{ fontSize: 13 }}>{telefoneExibicao(customer)}</strong></div>
        <div style={dado}><span style={roleta}>Membro desde</span><strong style={{ fontSize: 13 }}>{mc.criadoEm ? fmtDate(mc.criadoEm) : '—'}</strong></div>
      </div>

      {/* Editar nome + telefone */}
      <div style={sec}>
        <div style={secTitle}>Editar perfil</div>
        <div style={{ marginBottom: 12 }}>
          <label style={label}>Nome</label>
          <input className="form-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" />
        </div>
        <div>
          <label style={label}>Telefone (WhatsApp)</label>
          <input className="form-input" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(38) 99999-9999" />
          <span style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4, display: 'block' }}>
            {soDigitos(telefone).length >= 10 ? telFormatado : 'DDD + número (mínimo 10 dígitos).'} Seus pedidos continuam no mesmo cadastro.
          </span>
        </div>
        <button style={{ ...primary, opacity: !perfilAlterado || savingPerfil ? 0.55 : 1, cursor: !perfilAlterado || savingPerfil ? 'default' : 'pointer' }}
          disabled={!perfilAlterado || savingPerfil} onClick={salvarPerfil}>
          {savingPerfil ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>

      {/* Alterar e-mail (fluxo oficial Supabase) */}
      <div style={sec}>
        <div style={secTitle}>Alterar e-mail</div>
        {emailPendente ? (
          <p style={{ fontSize: 13, color: 'var(--grape)', lineHeight: 1.5, background: 'var(--grape-pale)', padding: '10px 12px', borderRadius: 10 }}>
            📩 Confirmação enviada. Abra o link no seu novo e-mail para concluir a troca — sua conta e pedidos continuam os mesmos.
          </p>
        ) : (
          <>
            <label style={label}>Novo e-mail</label>
            <input className="form-input" type="email" inputMode="email" value={novoEmail}
              onChange={(e) => setNovoEmail(e.target.value)} placeholder="novo@email.com"
              onKeyDown={(e) => e.key === 'Enter' && enviarTrocaEmail()} />
            <span style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 4, display: 'block' }}>
              Enviaremos um link de confirmação. A troca só vale depois que você confirmar.
            </span>
            <button style={{ ...ghost, opacity: savingEmail ? 0.55 : 1, cursor: savingEmail ? 'default' : 'pointer' }}
              disabled={savingEmail} onClick={enviarTrocaEmail}>
              {savingEmail ? 'Enviando…' : 'Enviar confirmação'}
            </button>
          </>
        )}
      </div>

      {toast && <Toast tipo={toast.tipo} onClose={() => setToast(null)}>{toast.msg}</Toast>}
    </ScreenModal>
  );
}
