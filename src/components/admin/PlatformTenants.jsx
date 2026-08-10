/* components/admin/PlatformTenants.jsx — REF-SAAS-02 · Onda 1 (Fases 8-14, 19-20).
   Gestao profissional de tenants do Platform Console: lista com status real, detalhe por loja
   (administradores/empresa/domínios/operação), provisionamento de loja nova, abrir o Admin de uma loja,
   suspender/reativar, vincular/desvincular administrador.

   NAO duplica o Admin da loja (Catálogo/Pedidos/Delivery/etc continuam só lá, via "Abrir Admin") -- isto
   e' supervisao/gestao de tenant, nao operação. RPCs: platform_list_tenants/platform_tenant_detail/
   platform_set_store_status/platform_unlink_store_admin (novas, Onda 1) + provision_store/
   link_store_admin (Onda 8, reaproveitadas sem alteração nenhuma). */
import { useEffect, useState, useCallback } from 'react';
import { DS } from '../../services/DataService.js';
import { fmtDataHoraLoja } from '../../utils/format.js'; // REF-DATETIME-01: unico formatador de data/hora do app
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

function slugify(nome) {
  return String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const CORES_STATUS = {
  ativo:     { bg: '#F0FDF4', fg: '#15803D', ponto: '🟢' },
  suspenso:  { bg: '#FEF9C3', fg: '#854D0E', ponto: '🟡' },
  cancelado: { bg: '#FEF2F2', fg: '#B91C1C', ponto: '🔴' },
};

/* Status OPERACIONAL (Fase 15) -- distinto do status bruto da loja: uma loja 'ativo' sem nenhum admin
   nao esta operacional de verdade (ninguem consegue logar). Nunca deriva de um campo arbitrario. */
function statusOperacional(loja) {
  if (loja.status === 'suspenso') return { texto: 'Suspensa', ...CORES_STATUS.suspenso };
  if (loja.status === 'cancelado') return { texto: 'Cancelada', ...CORES_STATUS.cancelado };
  if (loja.admin_count === 0) return { texto: 'Em configuração', ...CORES_STATUS.suspenso };
  return { texto: 'Operacional', ...CORES_STATUS.ativo };
}

/* Fase 18: separa o endereço PADRAO da VALION (automatico por slug, sem SQL manual -- ver
   get_store_by_domain na migration REF-SAAS-02-onda1) do domínio PERSONALIZADO do cliente (opcional).
   So' marca o padrao como confirmado quando `dominio` bate exatamente com o padrao esperado (e' o que
   prova que o hostname resolve de verdade -- Encanto tem isto desde a Onda 0); sem isso, o código já
   está pronto mas depende do domínio curinga *.valionsistemas.com.br (feito 1 vez para a plataforma
   inteira, não por loja) ainda ser apontado no DNS/Vercel -- infra fora do alcance desta REF. */
function statusEndereco(loja) {
  const padraoStorefront = `${loja.slug}.valionsistemas.com.br`;
  const padraoAdmin = `admin.${loja.slug}.valionsistemas.com.br`;
  if (loja.dominio === padraoStorefront) {
    return { padraoConfirmado: true, storefrontUrl: padraoStorefront, adminUrl: padraoAdmin, personalizado: null };
  }
  if (loja.dominio) {
    return { padraoConfirmado: false, storefrontUrl: padraoStorefront, adminUrl: padraoAdmin, personalizado: loja.dominio };
  }
  return { padraoConfirmado: false, storefrontUrl: padraoStorefront, adminUrl: padraoAdmin, personalizado: null };
}

function LinhaAdmin({ admin, storeId, onDesvinculado }) {
  const [enviando, setEnviando] = useState(false);
  const desvincular = async () => {
    if (enviando || !window.confirm(`Desvincular ${admin.email} desta loja?`)) return;
    setEnviando(true);
    try {
      await DS.platformUnlinkStoreAdmin(storeId, admin.user_id);
      onDesvinculado?.();
    } finally {
      setEnviando(false);
    }
  };
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{admin.email}</div>
        <div style={{ fontSize: 11.5, color: 'var(--gray-400)' }}>vinculado em {fmtDataHoraLoja(admin.created_at)}</div>
      </div>
      <button className="btn-secondary" onClick={desvincular} disabled={enviando} data-testid={`plataforma-desvincular-${admin.user_id}`}>
        {enviando ? 'Removendo…' : 'Desvincular'}
      </button>
    </div>
  );
}

function DetalheTenant({ loja, onFechar, onMudou, onAbrirAdmin }) {
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState(null);
  const [emailNovo, setEmailNovo] = useState('');
  const [vinculando, setVinculando] = useState(false);
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(() => {
    DS.platformTenantDetail(loja.store_id).then(setDetalhe).catch((e) => setErro(e?.message));
  }, [loja.store_id]);

  useEffect(() => { carregar(); }, [carregar]);

  const recarregarTudo = () => { carregar(); onMudou?.(); };

  const vincular = async () => {
    if (!emailNovo.trim() || vinculando) return;
    setVinculando(true); setMsg(null);
    try {
      const r = await DS.linkStoreAdmin(loja.store_id, emailNovo.trim());
      if (r.vinculado) { setMsg({ tipo: 'ok', texto: `${r.email} agora é admin desta loja.` }); setEmailNovo(''); recarregarTudo(); }
      else setMsg({ tipo: 'erro', texto: r.motivo });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e?.message || 'Não foi possível vincular.' });
    } finally { setVinculando(false); }
  };

  const mudarStatus = async (novoStatus) => {
    if (!window.confirm(`Mudar status de "${loja.nome}" para "${novoStatus}"?`)) return;
    await DS.platformSetStoreStatus(loja.store_id, novoStatus);
    recarregarTudo();
  };

  if (erro) return <p style={{ fontSize: 13, color: 'var(--red)' }}>{erro}</p>;
  if (!detalhe) return <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Carregando detalhe…</p>;

  const info = detalhe.company_info || {};
  const endereco = statusEndereco(loja);

  return (
    <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 12, paddingTop: 16 }} data-testid={`plataforma-detalhe-${loja.slug}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📋 Resumo</h4>
          <p style={{ fontSize: 12.5, color: 'var(--gray-600)', lineHeight: 1.9 }}>
            Criada em {fmtDataHoraLoja(detalhe.store.created_at)}<br/>
            {detalhe.counts.produtos} produto(s) · {detalhe.counts.categorias} categoria(s) · {detalhe.counts.pedidos} pedido(s)<br/>
            Horários: {detalhe.config.tem_horario_config ? '✓ configurados' : '⚠ usando padrão'}<br/>
            Entrega: {detalhe.config.tem_delivery_config ? '✓ configurada' : `⚠ padrão (${detalhe.config.delivery_eta_min} min)`}
          </p>

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>🏢 Empresa</h4>
          <p style={{ fontSize: 12.5, color: 'var(--gray-600)', lineHeight: 1.9 }}>
            {info.nomeCompleto}<br/>
            E-mail: {info.email || <em>não informado</em>}<br/>
            WhatsApp: {info.whatsapp || <em>não informado</em>}
          </p>

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>🌐 Domínios</h4>
          <p style={{ fontSize: 12.5, color: 'var(--gray-600)', lineHeight: 1.9 }}>
            Storefront padrão VALION: {endereco.storefrontUrl}{' '}
            {endereco.padraoConfirmado ? '✓' : '⚠ pendente (depende do domínio curinga da plataforma)'}<br/>
            Admin padrão VALION: {endereco.adminUrl}{' '}
            {endereco.padraoConfirmado ? '✓' : '⚠ pendente'}<br/>
            Domínio personalizado: {endereco.personalizado ? `✓ ${endereco.personalizado}` : '⚪ não utilizado'}
          </p>
        </div>

        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>👤 Administradores ({detalhe.admins.length})</h4>
          {detalhe.admins.length === 0 && <p style={{ fontSize: 12.5, color: 'var(--gray-400)' }}>Nenhum administrador vinculado ainda.</p>}
          {detalhe.admins.map((a) => (
            <LinhaAdmin key={a.user_id} admin={a} storeId={loja.store_id} onDesvinculado={recarregarTudo} />
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input className="form-input" placeholder="e-mail do novo administrador" value={emailNovo}
              data-testid={`plataforma-vincular-email-${loja.slug}`}
              onChange={(e) => { setEmailNovo(e.target.value); setMsg(null); }}
              onKeyDown={(e) => e.key === 'Enter' && vincular()} style={{ flex: 1 }} />
            <button className="btn-secondary" onClick={vincular} disabled={vinculando || !emailNovo.trim()} data-testid={`plataforma-vincular-btn-${loja.slug}`}>
              {vinculando ? 'Vinculando…' : 'Vincular'}
            </button>
          </div>
          {msg && <p style={{ fontSize: 12.5, marginTop: 8, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 24, flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={() => onAbrirAdmin(loja.store_id)} data-testid={`plataforma-abrir-admin-${loja.slug}`}>
              🔧 Abrir Admin da loja
            </button>
            {loja.status === 'ativo' ? (
              <button className="btn-secondary" onClick={() => mudarStatus('suspenso')} data-testid={`plataforma-suspender-${loja.slug}`}>⏸ Suspender</button>
            ) : loja.status === 'suspenso' ? (
              <button className="btn-secondary" onClick={() => mudarStatus('ativo')} data-testid={`plataforma-ativar-${loja.slug}`}>▶ Reativar</button>
            ) : null}
          </div>
        </div>
      </div>
      <button className="btn-secondary" onClick={onFechar} style={{ marginTop: 16 }}>Fechar detalhe</button>
    </div>
  );
}

function LinhaLoja({ loja, aberta, onAlternarDetalhe, onMudou, onAbrirAdmin }) {
  const status = statusOperacional(loja);
  return (
    <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 14, marginBottom: 12 }} data-testid={`plataforma-linha-${loja.slug}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{loja.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>/{loja.slug}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {loja.admin_count === 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B91C1C', background: '#FEF2F2', padding: '3px 10px', borderRadius: 20 }}>
              ⚠️ aguardando administrador
            </span>
          )}
          <span data-testid={`plataforma-status-${loja.slug}`} style={{ fontSize: 11.5, fontWeight: 700, color: status.fg, background: status.bg, padding: '3px 10px', borderRadius: 20 }}>
            {status.ponto} {status.texto}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn-secondary" onClick={() => onAlternarDetalhe(loja.store_id)} data-testid={`plataforma-ver-detalhe-${loja.slug}`}>
          {aberta ? 'Ocultar detalhe' : 'Ver detalhe'}
        </button>
        <button className="btn-secondary" onClick={() => onAbrirAdmin(loja.store_id)} data-testid={`plataforma-abrir-admin-lista-${loja.slug}`}>
          🔧 Abrir Admin
        </button>
      </div>
      {aberta && <DetalheTenant loja={loja} onFechar={() => onAlternarDetalhe(loja.store_id)} onMudou={onMudou} onAbrirAdmin={onAbrirAdmin} />}
    </div>
  );
}

export function PlatformTenants({ onAbrirAdmin }) {
  const [tenants, setTenants] = useState(null);
  const [erro, setErro] = useState(null);
  const [detalheAberto, setDetalheAberto] = useState(null);
  // REF-SAAS-01 · Onda 5: `stores`/`reloadStores` do AdminStoreProvider sao uma fonte SEPARADA de
  // platform_list_tenants() (esta usada so pela tela "Lojas" do Platform Console) -- e' quem alimenta o
  // seletor/rotulo do AdminPanel e o guard de switchStore ("ignora id que nao esta na lista"). Sem
  // recarregar as DUAS ao mesmo tempo, criar uma loja/vincular um admin deixava o AdminPanel "cego" pra
  // loja nova ate' um F5 (que aqui sempre volta ao login, REF-STABILITY-02) -- "Abrir Admin" trocava de
  // loja em silencio (guard ignorava o id desconhecido) e o Admin continuava mostrando a Encanto.
  const { reloadStores } = useAdminStore();

  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [emailAdmin, setEmailAdmin] = useState('');
  const [telefone, setTelefone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [emailContato, setEmailContato] = useState('');
  const [criando, setCriando] = useState(false);
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(() => {
    DS.platformListTenants().then(setTenants).catch((e) => setErro(e?.message || 'Não foi possível carregar as lojas.'));
    reloadStores();
  }, [reloadStores]);

  useEffect(() => { carregar(); }, [carregar]);

  const mudarNome = (v) => { setNome(v); if (!slugTocado) setSlug(slugify(v)); };

  const criarLoja = async () => {
    if (!nome.trim() || !slug.trim() || criando) return;
    setCriando(true); setMsg(null);
    try {
      const r = await DS.provisionStore(nome.trim(), slug.trim(), emailAdmin.trim() || null);
      const contato = {};
      if (telefone.trim()) contato.telefone = telefone.trim();
      if (whatsapp.trim()) contato.whatsapp = whatsapp.trim();
      if (emailContato.trim()) contato.email = emailContato.trim();
      if (Object.keys(contato).length > 0) {
        await DS.platformSetCompanyInfo(r.store_id, contato);
      }
      const detalheAdmin = r.admin?.vinculado
        ? ` Admin ${r.admin.email} já vinculado.`
        : emailAdmin.trim() ? ` ${r.admin.motivo}.` : ' Aguardando administrador — vincule um e-mail no detalhe da loja para deixá-la operacional.';
      setMsg({ tipo: 'ok', texto: `Loja "${r.nome}" criada.${detalheAdmin}` });
      setNome(''); setSlug(''); setSlugTocado(false); setEmailAdmin(''); setTelefone(''); setWhatsapp(''); setEmailContato('');
      carregar();
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e?.message || 'Não foi possível criar a loja.' });
    } finally {
      setCriando(false);
    }
  };

  if (erro) return <p style={{ fontSize: 13, color: 'var(--red)' }}>{erro}</p>;

  return (
    <div>
      <Bloco icone="🏪" titulo={`Lojas (${tenants?.length ?? '…'})`} descricao="Todos os tenants da plataforma, com status real de operação.">
        {tenants && tenants.length === 0 && <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Nenhuma loja encontrada.</p>}
        {tenants?.map((loja) => (
          <LinhaLoja
            key={loja.store_id}
            loja={loja}
            aberta={detalheAberto === loja.store_id}
            onAlternarDetalhe={(id) => setDetalheAberto((atual) => (atual === id ? null : id))}
            onMudou={carregar}
            onAbrirAdmin={onAbrirAdmin}
          />
        ))}
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
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">E-mail do administrador (opcional)</label>
            <input className="form-input" data-testid="plataforma-nova-email" type="email" placeholder="dono@barsogra.com.br — precisa já ter conta criada"
              value={emailAdmin} onChange={(e) => setEmailAdmin(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">E-mail de contato da empresa (opcional)</label>
            <input className="form-input" data-testid="plataforma-nova-contato-email" type="email" placeholder="contato@barsogra.com.br"
              value={emailContato} onChange={(e) => setEmailContato(e.target.value)} />
          </div>
        </div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <div className="form-group">
            <label className="form-label">Telefone (opcional)</label>
            <input className="form-input" data-testid="plataforma-nova-telefone" placeholder="47999999999"
              value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">WhatsApp (opcional)</label>
            <input className="form-input" data-testid="plataforma-nova-whatsapp" placeholder="47999999999"
              value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          </div>
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
