/* components/menu/CompletarCadastro.jsx — 1o acesso (LOGIN-ARCH-02.1): coleta Nome + Telefone.
   TELEFONE e a identidade principal; vinculo hibrido via completarCadastro. Guest-first: pode dispensar
   ("Agora nao") — nunca bloqueia a compra. Aparece so quando logado E ainda sem telefone. */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { ScreenModal } from './ScreenModal.jsx';
import { lerGuestIdentity } from '../../utils/guestIdentity.js'; // REF-CUSTOMER-01: reaproveita o que ja foi digitado como visitante

export function CompletarCadastro() {
  const { isLogged, precisaTelefone, completarCadastro, user } = useAuth();
  /* REF-CUSTOMER-01: se o visitante ja tinha digitado nome/telefone num pedido guest anterior (mesmo
     navegador), reaproveita aqui — e o UNICO lugar que escreve esses dados no Supabase (linkCustomer),
     entao isto e a "migracao" do cache local pra fonte oficial. Sucesso aqui -> carregarCustomer roda
     com cust.phone preenchido -> AuthProvider ja limpa o cache local (nao duplicado aqui). */
  const guestCache = lerGuestIdentity();
  const [nome, setNome] = useState(guestCache?.nome || '');
  const [tel, setTel] = useState(guestCache?.telefone || '');
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [dispensado, setDispensado] = useState(false);

  if (!isLogged || !precisaTelefone || dispensado) return null;

  const salvar = async () => {
    setErro('');
    if (!nome.trim()) { setErro('Informe seu nome.'); return; }
    if (tel.replace(/\D/g, '').length < 10) { setErro('Informe um telefone com DDD (mínimo 10 dígitos).'); return; }
    setBusy(true);
    const r = await completarCadastro(nome.trim(), tel);
    setBusy(false);
    /* REF-LOYALTY-01a: telefone com historico (pedidos/selos) nao e reivindicado automaticamente
       (protege a fidelidade/historico do convidado) -> mensagem clara; o cadastro segue dispensavel. */
    if (r?.data?.status === 'requer_verificacao') {
      setErro(r.data.error || 'Este telefone já possui histórico. Para vinculá-lo à sua conta, fale com a loja.');
      return;
    }
    const appErr = r?.error?.message || (r?.data?.ok === false ? r.data.error : null);
    if (appErr) {
      setErro(/outra conta/i.test(appErr) ? 'Este telefone já está vinculado a outra conta.' : 'Não foi possível salvar. Tente novamente.');
      return;
    }
    /* sucesso -> precisaTelefone vira false -> este modal desmonta sozinho */
  };

  return (
    <ScreenModal title="Complete seu cadastro" onClose={() => setDispensado(true)}>
      <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 12 }}>
        Só mais um passo — usamos seu telefone para pedidos, entrega, WhatsApp e benefícios.
      </p>
      {user?.email && <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 12 }}>Conectado como {user.email}</p>}
      <input className="form-input" placeholder="Seu nome" value={nome} onChange={e => setNome(e.target.value)} style={{ marginBottom: 10 }} />
      <input className="form-input" type="tel" placeholder="(38) 99999-9999" value={tel} onChange={e => setTel(e.target.value)} />
      {erro && <p style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{erro}</p>}
      <button className="btn-primary" style={{ width: '100%', marginTop: 12 }} disabled={busy} onClick={salvar}>
        {busy ? 'Salvando...' : 'Continuar'}
      </button>
      <button style={{ width: '100%', marginTop: 8, background: 'none', border: 'none', color: 'var(--gray-500)', cursor: 'pointer', fontSize: 13 }} onClick={() => setDispensado(true)}>
        Agora não
      </button>
    </ScreenModal>
  );
}
