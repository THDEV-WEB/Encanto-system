/* components/admin/AdminEmpresa.jsx — REF-COMPANY-01 (+03: Central de Configuração da Empresa).
   Controle administrativo de TODOS os dados institucionais da empresa — identidade, contato, texto
   "Sobre nós", redes sociais, endereço institucional, dados legais e configurações de preparo (timezone/
   idioma/moeda). FONTE ÚNICA no Supabase (settings via RPC set_company_info, mesmo par de RPCs desde a
   REF-COMPANY-01 — nenhuma migration nova nesta ref: o merge raso do servidor já aceita qualquer campo
   novo). Consome o MESMO valor que a loja (useCompanyInfo).

   Fluxo CLARO: TODOS os campos ficam pendentes num único form local até "Salvar Alterações" (botão único,
   no fim da página) — sem auto-save por bloco. Exceção: o toggle do botão flutuante do WhatsApp grava
   IMEDIATAMENTE (mesmo padrão de AdminFidelidade.toggleEnabled), mas de forma TRUTHFUL — só reflete o
   novo estado se o servidor confirmar. Valida no cliente (evita round-trip óbvio); o servidor sempre
   revalida (is_admin + as mesmas regras — ver companyInfoRules.js).

   ENDEREÇO: o bloco "📍 Endereço" aqui é o ENDEREÇO INSTITUCIONAL da empresa (company_info) — entidade
   INDEPENDENTE do endereço de RETIRADA usado no checkout (STORE_INFO.retirada, constants/storeInfo.js).
   Este componente NUNCA lê STORE_INFO — não há acoplamento entre as duas fontes. */
import { useState, useEffect, useMemo } from 'react';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { salvarCompanyInfo, formatarTelefoneBR } from '../../services/company/companyInfo.js';
import { normalizePhoneBR } from '../../services/notifications/WhatsAppService.js';

/* Campos do form PENDENTE (chave -> como extrair de `info` p/ o estado local editável). Telefone/whatsapp
   entram FORMATADOS para edição; os demais, como estão. whatsappFloatEnabled fica de fora (grava direto). */
const CAMPOS_TEXTO = [
  'nomeCurto', 'nomeCompleto', 'email', 'sobre',
  'instagram', 'facebook', 'tiktok', 'site', 'cardapio', 'googleMaps',
  'cep', 'rua', 'numero', 'bairro', 'cidade', 'estado',
  'cnpj', 'razaoSocial', 'nomeFantasia',
  'timezone', 'idioma', 'moeda',
];

function paraForm(info) {
  const f = { telefone: formatarTelefoneBR(info.telefone), whatsapp: formatarTelefoneBR(info.whatsapp) };
  for (const k of CAMPOS_TEXTO) f[k] = info[k] ?? '';
  return f;
}

/* Forma CANÔNICA (mesma normalização do servidor) p/ comparar "mudou" e p/ montar o patch de salvar. */
function paraPatch(form) {
  const p = { telefone: normalizePhoneBR(form.telefone), whatsapp: normalizePhoneBR(form.whatsapp) };
  for (const k of CAMPOS_TEXTO) p[k] = k === 'email' ? form[k].trim().toLowerCase() : form[k];
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

/* Card "Em breve" — reserva o LAYOUT para Logo/Favicon sem nenhum campo de dado (sem upload ainda). Quando
   a funcionalidade existir, o slot já está no lugar certo — não precisa reorganizar o bloco de Identidade. */
function EmBreveCard({ icone, titulo }) {
  return (
    <div style={{
      flex: 1, minWidth: 160, border: '1.5px dashed var(--gray-300)', borderRadius: 12,
      padding: '20px 16px', textAlign: 'center', color: 'var(--gray-400)',
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icone}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-600)' }}>{titulo}</div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: 'var(--gray-400)', background: 'var(--gray-100)',
        borderRadius: 20, padding: '3px 10px', display: 'inline-block', marginTop: 8,
      }}>Em breve</div>
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
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <EmBreveCard icone="🖼️" titulo="Logo da empresa" />
          <EmBreveCard icone="🔖" titulo="Favicon" />
        </div>
      </Bloco>

      <Bloco icone="📞" titulo="Contato" descricao="Telefone, WhatsApp e e-mail usados pela loja e pelo checkout.">
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
