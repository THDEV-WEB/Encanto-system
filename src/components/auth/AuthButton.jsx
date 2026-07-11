/* components/auth/AuthButton.jsx — ponto de entrada do login do cliente no header da loja (AUTH-01).
   Login SEMPRE opcional: abre a folha de login (visitante) ou o menu da conta (logado). Se a auth nao
   estiver configurada (dbCliente=null), NAO renderiza nada -> a loja segue 100% como visitante. */
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { LoginSheet } from './LoginSheet.jsx';
import { AccountMenu } from './AccountMenu.jsx';

export function AuthButton() {
  const { isLogged, disponivel } = useAuth();
  const [open, setOpen] = useState(false);
  if (!disponivel) return null;

  return (
    <>
      <button
        className="header-auth-btn"
        onClick={() => setOpen(true)}
        title={isLogged ? 'Minha conta' : 'Entrar'}
        style={{
          border: '1px solid var(--gray-200)', background: 'var(--white)', borderRadius: 20,
          padding: '6px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', color: 'var(--grape)',
        }}>
        {isLogged ? '👤' : 'Entrar'}
      </button>
      {open && !isLogged && <LoginSheet onClose={() => setOpen(false)} />}
      {open &&  isLogged && <AccountMenu onClose={() => setOpen(false)} />}
    </>
  );
}
