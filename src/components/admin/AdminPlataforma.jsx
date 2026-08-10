/* components/admin/AdminPlataforma.jsx — REF-SAAS-01 · Onda 8: provisionamento assistido de loja nova.
   UI MINIMA do Super Admin da VALION SISTEMAS -- so o necessario pra tornar a Onda 8 operavel (criar
   loja, ver lojas existentes, vincular admin por e-mail). Explicitamente NAO e o Super Admin completo
   do roadmap (sem billing/planos/metricas globais/suporte/impersonation/suspensao avancada -- backlog).

   Aba so aparece pra quem is_super_admin() (ver AdminPanel.jsx) -- nunca condicionada a stores.length,
   porque e exatamente com 1 loja so que o Super Admin precisa deste ponto de entrada pra criar a 2a.

   provision_store/link_store_admin sao SECURITY DEFINER com is_super_admin() como 1a linha de logica
   (banco decide, nao esta UI) -- ver migrations/REF-SAAS-01-onda8-provisionamento.sql. Vinculo de admin
   so funciona se a pessoa JA tem conta (auth.users) -- criar essa conta continua manual (Supabase
   Dashboard), decisao explicita da onda pra nao expor service_role nem inventar solucao insegura. */
import { useState } from 'react';
import { DS } from '../../services/DataService.js';
import { useAdminStore } from '../../hooks/useAdminStore.js';

function Bloco({ icone, titulo, descricao, children }) {
  return (
    <div className="admin-card" style={{ marginBottom: 20 }}>
      <div className="admin-card-header"><h3>{icone} {titulo}</h3></div>
      <div style={{ padding: '20px' }}>
        {descricao && <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 18, lineHeight: 1.6 }}>{descricao}</p>}
        {children}
      </div>
    </div>
  );
}

function badgeStatus(status) {
  const cores = {
    ativo:     { bg: '#F0FDF4', fg: '#15803D' },
    suspenso:  { bg: '#FEF9C3', fg: '#854D0E' },
    cancelado: { bg: '#FEF2F2', fg: '#B91C1C' },
  };
  const c = cores[status] || cores.ativo;
  return (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: c.fg, background: c.bg, padding: '3px 10px', borderRadius: 20 }}>
      {status}
    </span>
  );
}

function slugify(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Linha de loja existente + mini-form de vincular admin por e-mail (reutilizavel pra qualquer loja da
   lista, nao so a recem-criada -- uma loja pode ganhar mais de 1 admin ao longo do tempo). */
function LinhaLoja({ loja, onVinculado }) {
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState(null);

  const vincular = async () => {
    if (!email.trim() || enviando) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await DS.linkStoreAdmin(loja.store_id, email.trim());
      if (r.vinculado) {
        setMsg({ tipo: 'ok', texto: `${r.email} agora e admin desta loja.` });
        setEmail('');
        onVinculado?.();
      } else {
        setMsg({ tipo: 'erro', texto: r.motivo });
      }
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e?.message || 'Nao foi possivel vincular.' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{loja.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            /{loja.slug} {loja.dominio ? `· ${loja.dominio}` : '· sem domínio ainda (DNS/Vercel pendentes)'}
          </div>
        </div>
        {badgeStatus(loja.status)}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input className="form-input" placeholder="e-mail do administrador desta loja" value={email}
          data-testid={`plataforma-vincular-email-${loja.slug}`}
          onChange={(e) => { setEmail(e.target.value); setMsg(null); }}
          onKeyDown={(e) => e.key === 'Enter' && vincular()} style={{ flex: 1 }} />
        <button className="btn-secondary" onClick={vincular} disabled={enviando || !email.trim()}
          data-testid={`plataforma-vincular-btn-${loja.slug}`}>
          {enviando ? 'Vinculando…' : 'Vincular admin'}
        </button>
      </div>
      {msg && <p style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</p>}
    </div>
  );
}

export function AdminPlataforma() {
  const { stores, reloadStores } = useAdminStore();
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [emailAdmin, setEmailAdmin] = useState('');
  const [criando, setCriando] = useState(false);
  const [msg, setMsg] = useState(null);

  const mudarNome = (v) => { setNome(v); if (!slugTocado) setSlug(slugify(v)); };

  const criarLoja = async () => {
    if (!nome.trim() || !slug.trim() || criando) return;
    setCriando(true); setMsg(null);
    try {
      const r = await DS.provisionStore(nome.trim(), slug.trim(), emailAdmin.trim() || null);
      const detalheAdmin = r.admin?.vinculado
        ? ` Admin ${r.admin.email} ja vinculado.`
        : emailAdmin.trim() ? ` ${r.admin.motivo}.` : '';
      setMsg({ tipo: 'ok', texto: `Loja "${r.nome}" criada.${detalheAdmin}` });
      setNome(''); setSlug(''); setSlugTocado(false); setEmailAdmin('');
      reloadStores();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e?.message || 'Nao foi possivel criar a loja.' });
    } finally {
      setCriando(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 19, fontWeight: 700, margin: 0 }}>🏛️ Plataforma VALION SISTEMAS</h2>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
          Provisionamento assistido de lojas (REF-SAAS-01 · Onda 8) — visível só para o Super Admin da plataforma.
        </p>
      </div>

      <Bloco icone="🏪" titulo={`Lojas (${stores.length})`} descricao="Todas as lojas da plataforma. Vincular um admin exige que a pessoa já tenha uma conta criada.">
        {stores.length === 0 && <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Nenhuma loja encontrada.</p>}
        {stores.map((loja) => <LinhaLoja key={loja.store_id} loja={loja} onVinculado={reloadStores} />)}
      </Bloco>

      <Bloco icone="➕" titulo="Nova loja" descricao='Cria a loja e semeia a configuração inicial (a marca NUNCA herda nome/contato/paleta da Encanto). Domínio próprio continua sendo configurado manualmente (DNS + Vercel) depois.'>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">Nome da loja</label>
            <input className="form-input" data-testid="plataforma-nova-nome" placeholder="Bar da Sogra"
              value={nome} onChange={(e) => mudarNome(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Slug (identificador único)</label>
            <input className="form-input" data-testid="plataforma-nova-slug" placeholder="bar-da-sogra"
              value={slug} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTocado(true); }} />
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">E-mail do administrador (opcional)</label>
          <input className="form-input" data-testid="plataforma-nova-email" type="email" placeholder="dono@barsogra.com.br — precisa já ter conta criada"
            value={emailAdmin} onChange={(e) => setEmailAdmin(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={criarLoja} disabled={criando || !nome.trim() || !slug.trim()}
          data-testid="plataforma-nova-criar">
          {criando ? 'Criando…' : '🏪 Criar loja'}
        </button>
        {msg && <p style={{ fontSize: 13, marginTop: 12, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</p>}
      </Bloco>
    </div>
  );
}
