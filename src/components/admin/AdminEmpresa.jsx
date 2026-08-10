/* components/admin/AdminEmpresa.jsx — REF-COMPANY-01 (+03: Central de Configuração da Empresa;
   +REF-SAAS-01 · Onda 6.2: branding por loja).
   Controle administrativo de TODOS os dados institucionais da empresa — identidade, contato, texto
   "Sobre nós", redes sociais, endereço institucional, dados legais, configurações de preparo (timezone/
   idioma/moeda) e branding (logo/favicon/paleta/Termos/Fidelidade). FONTE ÚNICA no Supabase
   (store_settings via RPC set_company_info, mesmo par de RPCs desde a REF-COMPANY-01 — a Onda 6.2 só
   migrou a tabela de settings global para store_settings por loja e ampliou o merge raso do servidor
   com os campos de branding). Consome o MESMO valor que a loja (useCompanyInfo).

   Fluxo CLARO: TODOS os campos ficam pendentes num único form local até "Salvar Alterações" (botão único,
   no fim da página) — sem auto-save por bloco. Exceção: o toggle do botão flutuante do WhatsApp grava
   IMEDIATAMENTE (mesmo padrão de AdminFidelidade.toggleEnabled), mas de forma TRUTHFUL — só reflete o
   novo estado se o servidor confirmar. Valida no cliente (evita round-trip óbvio); o servidor sempre
   revalida (is_admin_of(store_id) + as mesmas regras — ver companyInfoRules.js).

   ENDEREÇO: o bloco "📍 Endereço" aqui é o ENDEREÇO INSTITUCIONAL da empresa (company_info) — entidade
   INDEPENDENTE do endereço de RETIRADA usado no checkout (STORE_INFO.retirada, constants/storeInfo.js).
   Este componente NUNCA lê STORE_INFO — não há acoplamento entre as duas fontes.

   BRANDING (Onda 6.2): logo/favicon/paleta/Termos/Fidelidade só têm efeito visual no bundle do
   STOREFRONT (StoreApp.jsx) — o Admin não é skinado por loja (ver comentário de cabeçalho de
   companyInfoRules.js). ImageUploader é o MESMO componente já em produção para imagem de produto
   (Storage bucket "products"), só com uma subpasta diferente ("branding/"). */
import { useState, useEffect, useMemo } from 'react';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { salvarCompanyInfo, formatarTelefoneBR } from '../../services/company/companyInfo.js';
import { normalizePhoneBR } from '../../services/notifications/WhatsAppService.js';
import { ImageUploader } from './ImageUploader.jsx';

/* Campos do form PENDENTE (chave -> como extrair de `info` p/ o estado local editável). Telefone/whatsapp
   entram FORMATADOS para edição; os demais, como estão. whatsappFloatEnabled fica de fora (grava direto).
   termosSecoes/fidelidadeTexto (arrays) ficam fora desta lista — tratados à parte em paraForm/paraPatch. */
const CAMPOS_TEXTO = [
  'nomeCurto', 'nomeCompleto', 'email', 'sobre',
  'instagram', 'facebook', 'tiktok', 'site', 'cardapio', 'googleMaps',
  'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado',
  'cnpj', 'razaoSocial', 'nomeFantasia',
  'timezone', 'idioma', 'moeda',
  'logoUrl', 'faviconUrl', 'corPrimaria', 'corSecundaria', 'corDestaque',
];

function paraForm(info) {
  const f = { telefone: formatarTelefoneBR(info.telefone), whatsapp: formatarTelefoneBR(info.whatsapp) };
  for (const k of CAMPOS_TEXTO) f[k] = info[k] ?? '';
  f.termosSecoes = (info.termosSecoes || []).map((s) => ({ ...s }));
  f.fidelidadeTexto = [...(info.fidelidadeTexto || [])];
  return f;
}

/* Forma CANÔNICA (mesma normalização do servidor) p/ comparar "mudou" e p/ montar o patch de salvar. */
function paraPatch(form) {
  const p = { telefone: normalizePhoneBR(form.telefone), whatsapp: normalizePhoneBR(form.whatsapp) };
  for (const k of CAMPOS_TEXTO) p[k] = k === 'email' ? form[k].trim().toLowerCase() : form[k];
  p.termosSecoes = form.termosSecoes;
  p.fidelidadeTexto = form.fidelidadeTexto;
  return p;
}

/* ── Bloco visual: título + descrição + card, mesma linguagem visual de AdminStatus/AdminBusinessHours. */
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

function Campo({ label, hint, testId, ...props }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input className="form-input" data-testid={testId} {...props} />
      {hint && <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>{hint}</p>}
    </div>
  );
}

/* Rótulo simples acima de um widget não-textual (ImageUploader, color picker) — mesma linguagem visual
   de Campo/form-label, sem o <input> genérico. */
function Rotulo({ children, hint }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <label className="form-label">{children}</label>
      {hint && <p style={{ fontSize: 11, color: 'var(--gray-400)', margin: '2px 0 4px' }}>{hint}</p>}
    </div>
  );
}

export function AdminEmpresa() {
  const info = useCompanyInfo();              // valor OFICIAL salvo (fonte única)
  const [form, setForm] = useState(() => paraForm(info));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);        // { tipo:'ok'|'erro', texto }

  // quando o oficial muda de CONTEÚDO (mount/sync/outro save), o form reflete o novo oficial — comparado
  // por conteúdo (não por referência), para não descartar edição em andamento a cada poll de 60s.
  const infoKey = useMemo(() => JSON.stringify(paraPatch(paraForm(info))), [info]);
  useEffect(() => { setForm(paraForm(info)); setMsg(null); }, [infoKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const campo = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setMsg(null); };
  const mudou = infoKey !== JSON.stringify(paraPatch(form));

  const salvar = async () => {
    if (!mudou || salvando) return;
    setSalvando(true); setMsg(null);
    const r = await salvarCompanyInfo(paraPatch(form));
    setSalvando(false);
    if (r.ok) { setMsg({ tipo: 'ok', texto: 'Dados da empresa salvos com sucesso.' }); setForm(paraForm(r.info)); }
    else setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar.' });
  };

  /* ── Toggle do botão flutuante: grava IMEDIATAMENTE, mas TRUTHFUL (o hook reflete o servidor; se a
     escrita falhar, so a mensagem de erro aparece — o estado exibido nunca e o que nao persistiu, porque
     ele vem de `info`, nao de estado local otimista). */
  const [alternando, setAlternando] = useState(false);
  const alternarFloat = async (v) => {
    if (alternando) return;
    setAlternando(true);
    const r = await salvarCompanyInfo({ whatsappFloatEnabled: v });
    setAlternando(false);
    if (!r.ok) setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível alterar o botão flutuante.' });
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 19, fontWeight: 700, margin: 0 }}>🏢 Central de Configuração da Empresa</h2>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
          Identidade, contato, conteúdo institucional e redes sociais — tudo num só lugar, sem depender de código.
        </p>
      </div>

      <Bloco icone="🏷️" titulo="Identidade da Empresa" descricao="Nome exibido em cada superfície do sistema.">
        <div className="form-row" style={{ marginBottom: 20 }}>
          <Campo testId="empresa-form-nome-curto" label="Nome curto" value={form.nomeCurto} onChange={campo('nomeCurto')}
            hint="Cabeçalho da loja, painel admin, login e comanda impressa." />
          <Campo testId="empresa-form-nome-completo" label="Nome completo" value={form.nomeCompleto} onChange={campo('nomeCompleto')}
            hint="Título do site e documentos." />
        </div>
        <div className="form-row">
          <div>
            <Rotulo hint="Substitui a logo padrão no cabeçalho da loja. Deixe em branco para usar a logo padrão.">🖼️ Logo da empresa</Rotulo>
            <ImageUploader currentUrl={form.logoUrl || null} pasta="branding/logo"
              onUpload={(url) => { setForm((f) => ({ ...f, logoUrl: url || '' })); setMsg(null); }} />
          </div>
          <div>
            <Rotulo hint="Ícone exibido na aba do navegador. Deixe em branco para usar o favicon padrão.">🔖 Favicon</Rotulo>
            <ImageUploader currentUrl={form.faviconUrl || null} pasta="branding/favicon"
              onUpload={(url) => { setForm((f) => ({ ...f, faviconUrl: url || '' })); setMsg(null); }} />
          </div>
        </div>
      </Bloco>

      <Bloco icone="🎨" titulo="Paleta de Cores" descricao="Cores da loja (cabeçalho, botões, destaques). Aplicadas apenas na loja — o painel administrativo mantém a identidade própria.">
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Cor primária</label>
            <input type="color" data-testid="empresa-form-cor-primaria" value={form.corPrimaria}
              onChange={campo('corPrimaria')} style={{ width: '100%', height: 44, borderRadius: 8, border: '1px solid var(--gray-200)', cursor: 'pointer' }} />
          </div>
          <div className="form-group">
            <label className="form-label">Cor secundária</label>
            <input type="color" data-testid="empresa-form-cor-secundaria" value={form.corSecundaria}
              onChange={campo('corSecundaria')} style={{ width: '100%', height: 44, borderRadius: 8, border: '1px solid var(--gray-200)', cursor: 'pointer' }} />
          </div>
          <div className="form-group">
            <label className="form-label">Cor de destaque</label>
            <input type="color" data-testid="empresa-form-cor-destaque" value={form.corDestaque}
              onChange={campo('corDestaque')} style={{ width: '100%', height: 44, borderRadius: 8, border: '1px solid var(--gray-200)', cursor: 'pointer' }} />
          </div>
        </div>
      </Bloco>

      <Bloco icone="📜" titulo="Termos de Uso" descricao='Seções exibidas na tela "Termos e Políticas" da loja.'>
        {form.termosSecoes.map((s, i) => (
          <div key={i} style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Título</label>
              <input className="form-input" data-testid={`empresa-form-termos-titulo-${i}`} value={s.titulo}
                onChange={(e) => setForm((f) => ({ ...f, termosSecoes: f.termosSecoes.map((x, idx) => (idx === i ? { ...x, titulo: e.target.value } : x)) }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label">Texto</label>
              <textarea className="form-input" data-testid={`empresa-form-termos-corpo-${i}`} rows={3} value={s.corpo}
                style={{ resize: 'vertical' }}
                onChange={(e) => setForm((f) => ({ ...f, termosSecoes: f.termosSecoes.map((x, idx) => (idx === i ? { ...x, corpo: e.target.value } : x)) }))} />
            </div>
            <button type="button" className="btn-secondary" data-testid={`empresa-form-termos-remover-${i}`}
              onClick={() => setForm((f) => ({ ...f, termosSecoes: f.termosSecoes.filter((_, idx) => idx !== i) }))}>
              🗑️ Remover seção
            </button>
          </div>
        ))}
        <button type="button" className="btn-secondary" data-testid="empresa-form-termos-adicionar"
          onClick={() => setForm((f) => ({ ...f, termosSecoes: [...f.termosSecoes, { titulo: '', corpo: '' }] }))}>
          ➕ Adicionar seção
        </button>
      </Bloco>

      <Bloco icone="🎁" titulo="Fidelidade" descricao='Parágrafos exibidos na tela "Programa de Fidelidade" da loja.'>
        {form.fidelidadeTexto.map((par, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
            <textarea className="form-input" data-testid={`empresa-form-fidelidade-${i}`} rows={2} value={par}
              style={{ resize: 'vertical', flex: 1 }}
              onChange={(e) => setForm((f) => ({ ...f, fidelidadeTexto: f.fidelidadeTexto.map((x, idx) => (idx === i ? e.target.value : x)) }))} />
            <button type="button" className="btn-secondary" data-testid={`empresa-form-fidelidade-remover-${i}`}
              onClick={() => setForm((f) => ({ ...f, fidelidadeTexto: f.fidelidadeTexto.filter((_, idx) => idx !== i) }))}>
              🗑️
            </button>
          </div>
        ))}
        <button type="button" className="btn-secondary" data-testid="empresa-form-fidelidade-adicionar"
          onClick={() => setForm((f) => ({ ...f, fidelidadeTexto: [...f.fidelidadeTexto, ''] }))}>
          ➕ Adicionar parágrafo
        </button>
      </Bloco>

      <Bloco icone="📞" titulo="Contato" descricao="Telefone, WhatsApp e e-mail usados pela loja e pelo checkout.">
        {/* REF-SAAS-01 · Onda 7.1: sem WhatsApp configurado, o pedido do cliente é registrado mas a
            confirmação automática não tem para onde ir — mesmo padrão de aviso já usado em "Taxa de
            Entrega" quando falta a posição da loja. */}
        {!info.whatsapp && (
          <div style={{ padding: '10px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: '#B91C1C' }}>
              ⚠️ WhatsApp ainda não configurado — os pedidos serão registrados, mas os clientes não conseguirão enviar a confirmação automática pra loja.
            </span>
          </div>
        )}
        <div className="form-row" style={{ marginBottom: 16 }}>
          <Campo testId="empresa-form-telefone" label="Telefone principal" placeholder="(47) 99999-9999" value={form.telefone} onChange={campo('telefone')} />
          <Campo testId="empresa-form-whatsapp" label="WhatsApp oficial" placeholder="(47) 99999-9999" value={form.whatsapp} onChange={campo('whatsapp')} />
        </div>
        <div className="form-row" style={{ marginBottom: 18 }}>
          <Campo testId="empresa-form-email" label="E-mail institucional" type="email" value={form.email} onChange={campo('email')} />
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
          padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 10,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>Botão flutuante do WhatsApp</div>
            <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>Exibido na loja para contato rápido.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontSize: 12, fontWeight: 700, color: info.whatsappFloatEnabled ? '#15803D' : '#B91C1C',
              background: info.whatsappFloatEnabled ? '#F0FDF4' : '#FEF2F2', padding: '4px 12px', borderRadius: 20,
            }}>{info.whatsappFloatEnabled ? '🟢 Ativo' : '🔴 Desativado'}</span>
            <label className="toggle-switch">
              <input data-testid="empresa-form-wa-float" type="checkbox" checked={info.whatsappFloatEnabled}
                disabled={alternando} onChange={(e) => alternarFloat(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </Bloco>

      <Bloco icone="📝" titulo="Sobre a Empresa" descricao='Texto exibido na tela "Sobre nós" da loja. Quebras de linha e parágrafos são preservados exatamente como digitados.'>
        <div className="form-group">
          <label className="form-label">Texto "Sobre nós"</label>
          <textarea data-testid="empresa-form-sobre" className="form-input" rows={10} value={form.sobre}
            onChange={campo('sobre')} style={{ resize: 'vertical', lineHeight: 1.6, fontFamily: 'var(--font-body)', minHeight: 180 }} />
        </div>
      </Bloco>

      <Bloco icone="🌐" titulo="Redes Sociais" descricao="Links exibidos no menu da loja. Campo vazio simplesmente não aparece — nunca um link quebrado.">
        <div className="form-row" style={{ marginBottom: 16 }}>
          <Campo label="Instagram" placeholder="https://instagram.com/sua-loja" value={form.instagram} onChange={campo('instagram')} />
          <Campo label="Facebook" placeholder="https://facebook.com/sua-loja" value={form.facebook} onChange={campo('facebook')} />
        </div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <Campo label="TikTok" placeholder="https://tiktok.com/@sua-loja" value={form.tiktok} onChange={campo('tiktok')} />
          <Campo label="Site" placeholder="https://suaempresa.com.br" value={form.site} onChange={campo('site')} />
        </div>
        <div className="form-row">
          <Campo label="Link do cardápio" placeholder="https://..." value={form.cardapio} onChange={campo('cardapio')} />
          <Campo label="Google Maps" placeholder="https://maps.app.goo.gl/..." value={form.googleMaps} onChange={campo('googleMaps')} />
        </div>
      </Bloco>

      <Bloco icone="📍" titulo="Endereço Institucional"
        descricao="Endereço oficial da empresa (para rodapé, contato e documentos). Independente do endereço de retirada usado no checkout — alterar aqui não afeta a retirada de pedidos.">
        <div className="form-row" style={{ marginBottom: 16 }}>
          <Campo label="CEP" placeholder="00000-000" value={form.cep} onChange={campo('cep')} />
          <Campo label="Estado (UF)" placeholder="SC" maxLength={2} value={form.estado} onChange={campo('estado')} />
        </div>
        <div className="form-row" style={{ marginBottom: 16 }}>
          <Campo label="Rua" value={form.rua} onChange={campo('rua')} />
          <Campo label="Número" value={form.numero} onChange={campo('numero')} />
        </div>
        <div className="form-row">
          <Campo label="Bairro" value={form.bairro} onChange={campo('bairro')} />
          <Campo label="Cidade" value={form.cidade} onChange={campo('cidade')} />
        </div>
      </Bloco>

      <Bloco icone="📄" titulo="Informações Institucionais" descricao="Dados legais da empresa (documentos, notas fiscais, contratos).">
        <div className="form-row" style={{ marginBottom: 16 }}>
          <Campo label="CNPJ" placeholder="00.000.000/0000-00" value={form.cnpj} onChange={campo('cnpj')} />
          <Campo label="Nome fantasia" value={form.nomeFantasia} onChange={campo('nomeFantasia')} />
        </div>
        <div className="form-row">
          <Campo label="Razão social" value={form.razaoSocial} onChange={campo('razaoSocial')} />
        </div>
      </Bloco>

      <Bloco icone="⚙️" titulo="Configurações" descricao="Preparado para evolução futura (múltiplas lojas, outros idiomas/moedas) — ainda sem efeito funcional no sistema.">
        <div className="form-row">
          <Campo label="Timezone" value={form.timezone} onChange={campo('timezone')} />
          <Campo label="Idioma" value={form.idioma} onChange={campo('idioma')} />
          <Campo label="Moeda" value={form.moeda} onChange={campo('moeda')} />
        </div>
      </Bloco>

      <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 8, paddingTop: 24, textAlign: 'center' }}>
        <button className="btn-primary" onClick={salvar} disabled={!mudou || salvando}
          style={{ minWidth: 260, padding: '14px 28px', fontSize: 16, fontWeight: 700, borderRadius: 12 }}>
          💾 {salvando ? 'Salvando…' : 'Salvar Alterações'}
        </button>
        {!mudou && !msg && <p style={{ fontSize: 12.5, color: 'var(--gray-400)', marginTop: 10 }}>Nenhuma alteração pendente.</p>}
        {msg && (
          <p style={{ fontSize: 13, marginTop: 10, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</p>
        )}
      </div>
    </div>
  );
}
