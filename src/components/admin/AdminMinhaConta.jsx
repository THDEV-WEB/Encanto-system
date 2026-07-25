/* components/admin/AdminMinhaConta.jsx — REF-CUSTOMER-01 (Parte 3, prep da area "Minha Conta" do Admin).
   Escopo desta REF: dados JA disponiveis pela propria sessao Supabase Auth (session.user) - nome/foto
   vem do user_metadata (preenchido pelo login Google quando existir), e-mail/ultimo login/criado-em sao
   nativos do GoTrue - ZERO schema novo. Telefone e um campo novo em user_metadata (mesmo padrao que
   AuthService.atualizarNome ja usa pro CLIENTE via dbCliente; aqui espelhado pro client `db`, do Admin).
   Troca de senha via auth.updateUser({password}) - fluxo oficial do Supabase, sem invalidar a sessao
   atual. NAO implementa gerenciamento de multiplos administradores (fora de escopo: a tabela `admins`
   hoje so tem id/user_id/created_at, sem papel/permissao — isso e uma REF propria). */
import { useState } from 'react';
import { db } from '../../lib/supabase.js';

function formatarData(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return '—'; }
}

const btnSalvar = (desabilitado) => ({
  padding: '10px 18px', borderRadius: 10, border: 'none',
  cursor: desabilitado ? 'default' : 'pointer',
  background: desabilitado ? 'var(--gray-200)' : 'var(--grape)',
  color: desabilitado ? 'var(--gray-500)' : '#fff',
  fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-body)',
});
const msgStyle = (tipo) => ({ fontSize: 13, marginTop: 10, fontWeight: 600, color: tipo === 'ok' ? '#16A34A' : '#DC2626' });

export function AdminMinhaConta({ admin }) {
  const user = admin?.session?.user;
  const meta = user?.user_metadata || {};
  const [nome, setNome] = useState(meta.full_name || meta.name || '');
  const [telefone, setTelefone] = useState(meta.phone || '');
  const [senha, setSenha] = useState('');
  const [confirmSenha, setConfirmSenha] = useState('');
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [msgPerfil, setMsgPerfil] = useState(null);
  const [msgSenha, setMsgSenha] = useState(null);

  const salvarPerfil = async () => {
    if (!db) return;
    setSalvandoPerfil(true); setMsgPerfil(null);
    const { error } = await db.auth.updateUser({ data: { full_name: nome.trim(), phone: telefone.trim() } });
    setSalvandoPerfil(false);
    setMsgPerfil(error ? { tipo: 'erro', texto: 'Não foi possível salvar. Tente novamente.' } : { tipo: 'ok', texto: 'Dados atualizados.' });
  };

  const salvarSenha = async () => {
    if (!db) return;
    if (senha.length < 6) { setMsgSenha({ tipo: 'erro', texto: 'A senha deve ter ao menos 6 caracteres.' }); return; }
    if (senha !== confirmSenha) { setMsgSenha({ tipo: 'erro', texto: 'As senhas não coincidem.' }); return; }
    setSalvandoSenha(true); setMsgSenha(null);
    const { error } = await db.auth.updateUser({ password: senha });
    setSalvandoSenha(false);
    if (error) { setMsgSenha({ tipo: 'erro', texto: error.message || 'Não foi possível trocar a senha.' }); return; }
    setSenha(''); setConfirmSenha('');
    setMsgSenha({ tipo: 'ok', texto: 'Senha atualizada com sucesso.' });
  };

  return (
    <>
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <div className="admin-card-header"><h3>👤 Meus Dados</h3></div>
        <div style={{ padding: '24px 20px' }}>
          {meta.picture && (
            <img src={meta.picture} alt="" width={64} height={64} style={{ borderRadius: '50%', marginBottom: 16, display: 'block' }} />
          )}
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 4 }}>E-mail</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--gray-900)', marginBottom: 16 }}>{user?.email || '—'}</p>

          <label className="form-label">Nome</label>
          <input className="form-input" data-testid="minhaconta-admin-nome" value={nome} onChange={(e) => setNome(e.target.value)} style={{ marginBottom: 12 }} />

          <label className="form-label">Telefone</label>
          <input className="form-input" data-testid="minhaconta-admin-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(38) 99999-9999" style={{ marginBottom: 12 }} />

          <button type="button" data-testid="minhaconta-admin-salvar-perfil" onClick={salvarPerfil} disabled={salvandoPerfil} style={btnSalvar(salvandoPerfil)}>
            {salvandoPerfil ? 'Salvando…' : 'Salvar dados'}
          </button>
          {msgPerfil && <p data-testid="minhaconta-admin-msg-perfil" style={msgStyle(msgPerfil.tipo)}>{msgPerfil.texto}</p>}

          <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 16 }}>
            Último login: {formatarData(user?.last_sign_in_at)} · Conta criada em: {formatarData(user?.created_at)}
          </p>
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-header"><h3>🔒 Alterar Senha</h3></div>
        <div style={{ padding: '24px 20px' }}>
          <label className="form-label">Nova senha</label>
          <input className="form-input" data-testid="minhaconta-admin-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} style={{ marginBottom: 12 }} />
          <label className="form-label">Confirmar nova senha</label>
          <input className="form-input" data-testid="minhaconta-admin-confirmar-senha" type="password" value={confirmSenha} onChange={(e) => setConfirmSenha(e.target.value)} style={{ marginBottom: 12 }} />
          <button type="button" data-testid="minhaconta-admin-salvar-senha" onClick={salvarSenha} disabled={salvandoSenha} style={btnSalvar(salvandoSenha)}>
            {salvandoSenha ? 'Salvando…' : 'Alterar senha'}
          </button>
          {msgSenha && <p data-testid="minhaconta-admin-msg-senha" style={msgStyle(msgSenha.tipo)}>{msgSenha.texto}</p>}
        </div>
      </div>
    </>
  );
}
