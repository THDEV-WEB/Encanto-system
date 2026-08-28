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

/* Fase 18 (+ REF-STORE-ONBOARD-01 Onda 2/3): separa o endereço PADRAO da VALION (automatico por slug)
   do domínio PERSONALIZADO do cliente (opcional). Dois padrões automáticos coexistem, nunca escolhidos
   por adivinhação: LEGADO (`{slug}.valionsistemas.com.br`, congelado -- só Encanto usa) e NOVO
   (`{slug}.lojas.valionsistemas.com.br`, o que `provision_store()` grava desde a Onda 2 em qualquer loja
   provisionada a partir de então).

   REF-STORE-ONBOARD-01 · Onda 3 (P2, correção de achado da auditoria): esta função SÓ calcula os hosts
   esperados a partir da string gravada em `dominio` -- ela NUNCA prova que o hostname resolve de
   verdade. A versão anterior (`padraoConfirmado`) comparava só string e mostrava "✓" pra QUALQUER loja
   nova, mesmo com zero CNAME criado no Registro.br (falso-positivo real, achado na auditoria de
   2026-08-22). A prova real agora vem de `VerificacaoDominio` abaixo, que faz uma checagem HTTPS ao
   vivo -- não uma comparação de string. */
function hostsEsperados(loja) {
  const padraoLegadoStorefront = `${loja.slug}.valionsistemas.com.br`;
  const padraoLegadoAdmin = `admin.${loja.slug}.valionsistemas.com.br`;
  const padraoNovoStorefront = `${loja.slug}.lojas.valionsistemas.com.br`;
  const padraoNovoAdmin = `${loja.slug}.admin.lojas.valionsistemas.com.br`;

  if (loja.dominio === padraoLegadoStorefront) {
    return { storefrontUrl: padraoLegadoStorefront, adminUrl: padraoLegadoAdmin, personalizado: null };
  }
  if (loja.dominio === padraoNovoStorefront) {
    return { storefrontUrl: padraoNovoStorefront, adminUrl: padraoNovoAdmin, personalizado: null };
  }
  if (loja.dominio) {
    return { storefrontUrl: padraoNovoStorefront, adminUrl: padraoNovoAdmin, personalizado: loja.dominio };
  }
  return { storefrontUrl: padraoNovoStorefront, adminUrl: padraoNovoAdmin, personalizado: null };
}

/* REF-STORE-ONBOARD-01 · Onda 3 (P2): prova REAL de que um host responde por HTTPS -- não string.
   mode:'no-cors' devolve sempre uma resposta opaca (não dá pra ler status/corpo), mas o browser só
   resolve essa promise depois de completar DNS+TCP+TLS+HTTP de verdade -- se qualquer uma dessas etapas
   falhar (o caso comum: CNAME ainda não criado no Registro.br), a promise REJEITA. É sinal real, mesmo
   sem conseguir ler a resposta. */
async function hostResponde(host) {
  try {
    await fetch(`https://${host}/`, { method: 'GET', mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(6000) });
    return true;
  } catch {
    return false;
  }
}

function RotuloVerificacao({ estado }) {
  if (estado === 'checando') return <span style={{ color: 'var(--gray-400)' }}>⏳ verificando…</span>;
  if (estado === 'ok') return <span style={{ color: '#16A34A', fontWeight: 600 }}>✅ respondendo</span>;
  return <span style={{ color: '#DC2626', fontWeight: 600 }}>❌ não responde ainda (configure o CNAME no Registro.br)</span>;
}

function LinhaAdmin({ admin, storeId, onDesvinculado }) {
  const [enviando, setEnviando] = useState(false);
  const [msgDesvincular, setMsgDesvincular] = useState(null);
  const desvincular = async () => {
    if (enviando || !window.confirm(`Desvincular ${admin.email} desta loja?`)) return;
    setEnviando(true); setMsgDesvincular(null);
    try {
      await DS.platformUnlinkStoreAdmin(storeId, admin.user_id);
      onDesvinculado?.();
    } catch (e) {
      // REF-AUTH-PLATFORM-ISOLATION-01 (Onda 2): platform_unlink_store_admin agora recusa (42501) alvo
      // em public.super_admins -- antes disso nunca lancava excecao pra um caller ja autorizado, entao
      // esta chamada nunca precisou de catch.
      setMsgDesvincular({ tipo: 'erro', texto: e?.message || 'Não foi possível desvincular.' });
    } finally {
      setEnviando(false);
    }
  };

  // REF-PROD-READINESS-01 (A6): super admin define a senha deste admin direto pelo Console -- nunca
  // mais um script que gera e imprime a senha no console. A senha digitada aqui nunca é logada em
  // lugar nenhum (nem console, nem rede fora desta chamada, nem no estado depois de confirmar).
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [definindo, setDefinindo] = useState(false);
  const [msgSenha, setMsgSenha] = useState(null);
  const definirSenha = async () => {
    if (definindo || novaSenha.length < 8) return;
    if (!window.confirm(`Definir uma nova senha para ${admin.email}? A senha atual dela deixa de funcionar.`)) return;
    setDefinindo(true); setMsgSenha(null);
    try {
      const r = await DS.platformSetStoreAdminPassword(admin.user_id, novaSenha);
      if (r?.error) { setMsgSenha({ tipo: 'erro', texto: r.reason || 'Não foi possível definir a senha.' }); return; }
      setMsgSenha({ tipo: 'ok', texto: 'Senha definida.' });
      setNovaSenha(''); setMostrarSenha(false);
    } catch (e) {
      setMsgSenha({ tipo: 'erro', texto: e?.message || 'Não foi possível definir a senha.' });
    } finally {
      setDefinindo(false);
    }
  };

  // REF-AUTH-PLATFORM-ISOLATION-01 (Onda 3): defesa de INTERFACE -- a protecao real ja e' do backend
  // (Ondas 1/2, platform-set-store-admin-password e platform_unlink_store_admin recusam o alvo). Aqui
  // so' refletimos o papel: uma linha de Super Admin nunca oferece os botoes de credencial de tenant.
  const ehSuperAdmin = admin.is_super_admin === true;

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--gray-100)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{admin.email}</div>
          <div style={{ fontSize: 11.5, color: 'var(--gray-400)' }}>vinculado em {fmtDataHoraLoja(admin.created_at)}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {ehSuperAdmin ? (
            <span data-testid={`plataforma-super-admin-selo-${admin.user_id}`}
              style={{ fontSize: 11.5, fontWeight: 700, color: '#92400E', background: '#FEF3C7', padding: '3px 10px', borderRadius: 20 }}>
              👑 Super Admin da plataforma
            </span>
          ) : (
            <>
              <button className="btn-secondary" onClick={() => { setMostrarSenha((v) => !v); setMsgSenha(null); }} data-testid={`plataforma-definir-senha-toggle-${admin.user_id}`}>
                🔑 Definir senha
              </button>
              <button className="btn-secondary" onClick={desvincular} disabled={enviando} data-testid={`plataforma-desvincular-${admin.user_id}`}>
                {enviando ? 'Removendo…' : 'Desvincular'}
              </button>
            </>
          )}
        </div>
      </div>
      {!ehSuperAdmin && mostrarSenha && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input type="password" className="form-input" placeholder="nova senha (mínimo 8 caracteres)"
            value={novaSenha} onChange={(e) => { setNovaSenha(e.target.value); setMsgSenha(null); }}
            data-testid={`plataforma-nova-senha-${admin.user_id}`} style={{ flex: 1 }} />
          <button className="btn-primary" onClick={definirSenha} disabled={definindo || novaSenha.length < 8}
            data-testid={`plataforma-definir-senha-btn-${admin.user_id}`}>
            {definindo ? 'Definindo…' : 'Confirmar'}
          </button>
        </div>
      )}
      {!ehSuperAdmin && msgSenha && <p style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: msgSenha.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msgSenha.texto}</p>}
      {!ehSuperAdmin && msgDesvincular && <p style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: '#DC2626' }}>{msgDesvincular.texto}</p>}
    </div>
  );
}

/* REF-STORE-ONBOARD-02 · Onda 1: checklist de lancamento -- resume, num so' lugar, o que falta para
   esta loja ficar pronta pra ir ao ar de verdade. So' LEITURA (deriva 100% de platform_tenant_detail() +
   da mesma checagem HTTPS ja feita pra "Dominios" abaixo) -- nenhum item aqui tem acao propria, cada
   linha aponta pra a secao/tela onde a acao real acontece. */
function ItemChecklist({ ok, texto, nota, testid }) {
  return (
    <div data-testid={testid} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0' }}>
      <span style={{ fontSize: 14 }}>{ok ? '✅' : '⚠️'}</span>
      <div>
        <span style={{ fontSize: 12.5, fontWeight: ok ? 500 : 700, color: ok ? 'var(--gray-600)' : '#B45309' }}>{texto}</span>
        {!ok && nota && <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{nota}</div>}
      </div>
    </div>
  );
}

function ChecklistLancamento({ detalhe, hosts, verif, slug }) {
  const cfg = detalhe.config;
  const dominioOk = verif.storefront === 'ok' && verif.admin === 'ok';
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🚀 Checklist de lançamento</h4>
      <ItemChecklist testid={`plataforma-checklist-admin-${slug}`} ok={detalhe.admins.length > 0}
        texto="Administrador vinculado"
        nota="Sem admin, ninguém consegue logar nesta loja -- vincule abaixo, em Administradores." />
      <ItemChecklist testid={`plataforma-checklist-catalogo-${slug}`} ok={cfg.tem_catalogo}
        texto="Catálogo com produtos"
        nota="Clone o catálogo de outra loja abaixo, ou cadastre produtos direto no Admin desta loja." />
      <ItemChecklist testid={`plataforma-checklist-horario-${slug}`} ok={cfg.tem_horario_config}
        texto="Horário de funcionamento configurado"
        nota="Sem isso, o Admin desta loja mostra o horário de OUTRA loja como exemplo temporário." />
      <ItemChecklist testid={`plataforma-checklist-entrega-${slug}`} ok={cfg.tem_delivery_config}
        texto="Taxa de entrega configurada"
        nota="Sem isso, o Admin desta loja mostra a tabela de preço de OUTRA loja como exemplo temporário." />
      <ItemChecklist testid={`plataforma-checklist-coordenadas-${slug}`} ok={cfg.tem_coordenadas}
        texto="Coordenadas da loja definidas"
        nota="Risco real: sem isso, TODO pedido de entrega sai com taxa R$ 0,00 -- configure em Empresa/Taxa de Entrega, no Admin desta loja." />
      <ItemChecklist testid={`plataforma-checklist-eta-${slug}`} ok={cfg.tem_eta_customizado}
        texto="Tempo estimado de entrega revisado"
        nota={`Usando o padrão genérico (${cfg.delivery_eta_min} min) até ser revisado no Admin desta loja.`} />
      <ItemChecklist testid={`plataforma-checklist-modo-${slug}`} ok={cfg.tem_modo_customizado}
        texto="Modo da loja revisado"
        nota="Usando o padrão automático (segue o horário configurado) até ser revisado no Admin desta loja." />
      <ItemChecklist testid={`plataforma-checklist-dominio-${slug}`} ok={dominioOk}
        texto="Domínio respondendo"
        nota={`Ação manual sua, fora do app: crie o CNAME de ${hosts.storefrontUrl} e de ${hosts.adminUrl} no Registro.br. O valor exato do CNAME aparece ao anexar cada host no projeto Vercel correspondente (encanto-system / encanto-admin) -- não é um valor fixo previsível pelo slug.`} />
    </div>
  );
}

function DetalheTenant({ loja, todasAsLojas, onFechar, onMudou, onAbrirAdmin }) {
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState(null);
  const [emailNovo, setEmailNovo] = useState('');
  const [vinculando, setVinculando] = useState(false);
  const [msg, setMsg] = useState(null);

  // REF-STORE-ONBOARD-01 · Onda 3 (P3): edição de domínio pelo Console.
  const [dominioEdit, setDominioEdit] = useState(loja.dominio || '');
  const [salvandoDominio, setSalvandoDominio] = useState(false);
  const [msgDominio, setMsgDominio] = useState(null);
  useEffect(() => { setDominioEdit(loja.dominio || ''); }, [loja.dominio]);

  // REF-STORE-ONBOARD-01 · Onda 3 (P2): checagem HTTPS ao vivo dos 2 hosts padrão desta loja.
  const hosts = hostsEsperados(loja);
  const [verif, setVerif] = useState({ storefront: 'checando', admin: 'checando' });
  useEffect(() => {
    let vivo = true;
    setVerif({ storefront: 'checando', admin: 'checando' });
    hostResponde(hosts.storefrontUrl).then((ok) => { if (vivo) setVerif((v) => ({ ...v, storefront: ok ? 'ok' : 'falha' })); });
    hostResponde(hosts.adminUrl).then((ok) => { if (vivo) setVerif((v) => ({ ...v, admin: ok ? 'ok' : 'falha' })); });
    return () => { vivo = false; };
  }, [hosts.storefrontUrl, hosts.adminUrl]);

  // REF-STORE-ONBOARD-01 · Onda 3 (P1): clonagem de catálogo, só oferecida quando esta loja está vazia
  // (mesma guarda de platform_clone_catalog -- checa aqui tb pra não deixar o usuário tentar à toa).
  const [origemClone, setOrigemClone] = useState('');
  const [clonando, setClonando] = useState(false);
  const [msgClone, setMsgClone] = useState(null);

  const carregar = useCallback(() => {
    DS.platformTenantDetail(loja.store_id).then(setDetalhe).catch((e) => setErro(e?.message));
  }, [loja.store_id]);

  useEffect(() => { carregar(); }, [carregar]);

  const recarregarTudo = () => { carregar(); onMudou?.(); };

  const salvarDominio = async () => {
    if (salvandoDominio) return;
    setSalvandoDominio(true); setMsgDominio(null);
    try {
      await DS.platformSetStoreDominio(loja.store_id, dominioEdit.trim());
      setMsgDominio({ tipo: 'ok', texto: 'Domínio atualizado.' });
      recarregarTudo();
    } catch (e) {
      setMsgDominio({ tipo: 'erro', texto: e?.message || 'Não foi possível atualizar o domínio.' });
    } finally {
      setSalvandoDominio(false);
    }
  };

  const clonarCatalogo = async () => {
    if (!origemClone || clonando) return;
    const nomeOrigem = todasAsLojas?.find((l) => l.store_id === origemClone)?.nome || 'loja selecionada';
    if (!window.confirm(`Clonar o catálogo de "${nomeOrigem}" para "${loja.nome}"? Os produtos entram desativados até você revisar.`)) return;
    setClonando(true); setMsgClone(null);
    try {
      const r = await DS.platformCloneCatalog(origemClone, loja.store_id);
      setMsgClone({ tipo: 'ok', texto: `${r.categorias} categoria(s), ${r.produtos} produto(s) e ${r.adicionais} adicional(is) clonados -- desativados até você revisar e ativar cada um no Admin da loja.` });
      setOrigemClone('');
      recarregarTudo();
    } catch (e) {
      setMsgClone({ tipo: 'erro', texto: e?.message || 'Não foi possível clonar o catálogo.' });
    } finally {
      setClonando(false);
    }
  };

  /* REF-STORE-ONBOARD-01 · Onda 2: DS.inviteStoreAdmin substitui DS.linkStoreAdmin aqui -- a Edge
     Function faz a MESMA chamada link_store_admin primeiro (comportamento de hoje intacto quando o
     e-mail já existe, `convidado:false`) e só recorre a convite (service_role) quando a conta não
     existe ainda (`convidado:true`). Um botão só, superset do que já funcionava. */
  const vincular = async () => {
    if (!emailNovo.trim() || vinculando) return;
    setVinculando(true); setMsg(null);
    try {
      const r = await DS.inviteStoreAdmin(loja.store_id, emailNovo.trim());
      if (r.error) { setMsg({ tipo: 'erro', texto: r.reason || 'Não foi possível vincular.' }); return; }
      if (r.vinculado) {
        const texto = r.convidado
          ? `${r.email} foi convidado e já é admin desta loja — vai receber um e-mail para definir a senha.`
          : `${r.email} agora é admin desta loja.`;
        setMsg({ tipo: 'ok', texto }); setEmailNovo(''); recarregarTudo();
      } else {
        setMsg({ tipo: 'erro', texto: r.motivo });
      }
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
  const catalogoVazio = detalhe.counts.produtos === 0 && detalhe.counts.categorias === 0;
  const opcoesOrigemClone = (todasAsLojas || []).filter((l) => l.store_id !== loja.store_id);

  return (
    <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 12, paddingTop: 16 }} data-testid={`plataforma-detalhe-${loja.slug}`}>
      <ChecklistLancamento detalhe={detalhe} hosts={hosts} verif={verif} slug={loja.slug} />
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
            Storefront padrão VALION: {hosts.storefrontUrl} <RotuloVerificacao estado={verif.storefront} /><br/>
            Admin padrão VALION: {hosts.adminUrl} <RotuloVerificacao estado={verif.admin} /><br/>
            Domínio personalizado: {hosts.personalizado ? `✓ ${hosts.personalizado}` : '⚪ não utilizado'}
          </p>
          <p style={{ fontSize: 11, color: 'var(--gray-400)', marginBottom: 8 }}>
            "Respondendo" é um teste HTTPS real feito agora pelo seu navegador -- não uma suposição a partir do texto gravado.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" placeholder="dominio-proprio.com.br (vazio = usar o padrão automático)"
              value={dominioEdit} data-testid={`plataforma-dominio-input-${loja.slug}`}
              onChange={(e) => { setDominioEdit(e.target.value); setMsgDominio(null); }}
              onKeyDown={(e) => e.key === 'Enter' && salvarDominio()} style={{ flex: 1 }} />
            <button className="btn-secondary" onClick={salvarDominio} disabled={salvandoDominio || dominioEdit.trim() === (loja.dominio || '')}
              data-testid={`plataforma-dominio-salvar-${loja.slug}`}>
              {salvandoDominio ? 'Salvando…' : 'Salvar domínio'}
            </button>
          </div>
          {msgDominio && <p style={{ fontSize: 12.5, marginTop: 6, fontWeight: 600, color: msgDominio.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msgDominio.texto}</p>}

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>📦 Catálogo</h4>
          {catalogoVazio ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="form-input" value={origemClone} data-testid={`plataforma-clone-origem-${loja.slug}`}
                  onChange={(e) => { setOrigemClone(e.target.value); setMsgClone(null); }} style={{ flex: 1 }}>
                  <option value="">Clonar catálogo de…</option>
                  {opcoesOrigemClone.map((l) => <option key={l.store_id} value={l.store_id}>{l.nome}</option>)}
                </select>
                <button className="btn-secondary" onClick={clonarCatalogo} disabled={!origemClone || clonando}
                  data-testid={`plataforma-clone-btn-${loja.slug}`}>
                  {clonando ? 'Clonando…' : '📦 Clonar'}
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                Copia categorias/produtos/adicionais como ponto de partida -- produtos entram desativados até você revisar. Nunca copia pedidos, clientes, endereços ou dados de acesso.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--gray-500)' }}>
              Esta loja já tem catálogo próprio ({detalhe.counts.categorias} categoria(s), {detalhe.counts.produtos} produto(s)) -- clonagem só é oferecida para catálogo vazio.
            </p>
          )}
          {msgClone && <p style={{ fontSize: 12.5, marginTop: 6, fontWeight: 600, color: msgClone.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msgClone.texto}</p>}
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
          <p style={{ fontSize: 11.5, color: 'var(--gray-400)', marginTop: 4 }}>
            Se o e-mail já tiver conta, vincula na hora. Se não tiver, envia um convite por e-mail para criar a conta.
          </p>
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

function LinhaLoja({ loja, todasAsLojas, aberta, onAlternarDetalhe, onMudou, onAbrirAdmin }) {
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
      {aberta && <DetalheTenant loja={loja} todasAsLojas={todasAsLojas} onFechar={() => onAlternarDetalhe(loja.store_id)} onMudou={onMudou} onAbrirAdmin={onAbrirAdmin} />}
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
            todasAsLojas={tenants}
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
