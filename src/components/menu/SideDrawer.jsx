/* components/menu/SideDrawer.jsx — drawer lateral da loja (LOGIN-ARCH-02.1). Guest-first.
   Topo: entrar/conta · Fidelidade · Contato · Sobre · Termos · redes. Entrada com slide suave; safe-area.
   REF-COMPANY-03: os links de redes sociais/site/cardápio/mapa vêm de company_info (Supabase,
   administráveis em Dados da Empresa) — não mais de STORE_INFO.social (removido). Cada ícone só aparece
   se o respectivo campo estiver preenchido; nunca um link vazio/quebrado. */
import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth.js';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { nomeExibicao, inicialExibicao, avatarUrlDe } from './userDisplay.js';

const overlay = (shown) => ({ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3100, display: 'flex', justifyContent: 'flex-end', opacity: shown ? 1 : 0, transition: 'opacity .2s ease' });
const drawer = (shown) => ({ width: '86%', maxWidth: 340, height: '100%', background: 'var(--white)', boxShadow: '-8px 0 30px rgba(0,0,0,.2)', display: 'flex', flexDirection: 'column', overflowY: 'auto', transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform .26s cubic-bezier(.2,.8,.2,1)', paddingBottom: 'env(safe-area-inset-bottom)' });
const item = { display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', border: 'none', background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontSize: 15, color: 'var(--gray-800)', borderBottom: '1px solid var(--gray-100)' };
const socialBtn = { width: 44, height: 44, borderRadius: '50%', background: 'var(--grape-pale)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, textDecoration: 'none' };

/* Ordem de exibição + emoji por campo — só entram os que tiverem valor (ver `links` no componente). */
const LINKS_SOCIAIS = [
  { campo: 'instagram', label: 'Instagram', emoji: '📷' },
  { campo: 'facebook', label: 'Facebook', emoji: '📘' },
  { campo: 'tiktok', label: 'TikTok', emoji: '🎵' },
  { campo: 'site', label: 'Site', emoji: '🌐' },
  { campo: 'cardapio', label: 'Cardápio', emoji: '📋' },
  { campo: 'googleMaps', label: 'Google Maps', emoji: '📍' },
];

export function SideDrawer({ onClose, onNavigate }) {
  const { isLogged, user, customer, sair } = useAuth();
  const companyInfo = useCompanyInfo();
  const links = LINKS_SOCIAIS.filter((l) => companyInfo[l.campo]);
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);

  const nome = nomeExibicao(customer, user);
  const inicial = inicialExibicao(nome);
  const avatarUrl = avatarUrlDe(user);

  return (
    <div style={overlay(shown)} onClick={e => e.target === e.currentTarget && onClose()}>
      <aside style={drawer(shown)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 20px', borderBottom: '1px solid var(--gray-100)' }}>
          <strong style={{ fontSize: 16 }}>Menu</strong>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--gray-500)' }} aria-label="Fechar">✕</button>
        </div>

        {/* Topo — entrar / conta */}
        <button aria-label="Login" style={{ ...item, background: 'var(--grape-pale)' }} onClick={() => onNavigate('login')}>
          {isLogged
            ? (avatarUrl
                ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--grape)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flexShrink: 0 }}>{inicial}</span>)
            : <span style={{ fontSize: 22, width: 40, textAlign: 'center', flexShrink: 0 }}>🔑</span>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isLogged ? (nome || 'Minha conta') : 'Entre ou cadastre-se'}</div>
            <div style={{ fontSize: 12, color: 'var(--gray-500)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isLogged ? (user?.email || 'Conectado') : 'Acesse pedidos e benefícios'}</div>
          </div>
        </button>

        {isLogged && (
          <button style={item} onClick={() => onNavigate('pedidos')}><span style={{ fontSize: 18 }}>🧾</span> Meus pedidos</button>
        )}
        {isLogged && (
          <button style={item} onClick={() => onNavigate('conta')}><span style={{ fontSize: 18 }}>👤</span> Minha Conta</button>
        )}
        <button style={item} onClick={() => onNavigate('fidelidade')}><span style={{ fontSize: 18 }}>🎁</span> Programa de Fidelidade</button>
        <button style={item} onClick={() => onNavigate('contato')}><span style={{ fontSize: 18 }}>📞</span> Contato</button>
        <button style={item} onClick={() => onNavigate('sobre')}><span style={{ fontSize: 18 }}>🏪</span> Sobre nós</button>
        <button style={item} onClick={() => onNavigate('termos')}><span style={{ fontSize: 18 }}>📄</span> Termos e Políticas</button>
        <button style={item} onClick={() => onNavigate('privacidade')}><span style={{ fontSize: 18 }}>🔒</span> Política de Privacidade</button>

        <div style={{ display: 'flex', gap: 14, padding: links.length ? '20px' : 0, marginTop: 'auto', flexWrap: 'wrap' }}>
          {links.map((l) => (
            <a key={l.campo} href={companyInfo[l.campo]} target="_blank" rel="noreferrer" aria-label={l.label} style={socialBtn}>{l.emoji}</a>
          ))}
        </div>

        {isLogged && (
          <button style={{ ...item, color: 'var(--red)', borderTop: '1px solid var(--gray-100)', borderBottom: 'none' }} onClick={async () => { await sair(); onClose(); }}>
            <span style={{ fontSize: 18 }}>🚪</span> Sair
          </button>
        )}
      </aside>
    </div>
  );
}
