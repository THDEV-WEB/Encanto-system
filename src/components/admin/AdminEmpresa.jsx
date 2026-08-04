/* components/admin/AdminEmpresa.jsx — REF-COMPANY-01.
   Controle administrativo dos DADOS INSTITUCIONAIS da empresa (nome, telefone, whatsapp, e-mail, botao
   flutuante do WhatsApp). FONTE UNICA no Supabase (settings via RPC set_company_info). Consome o MESMO
   valor que a loja (useCompanyInfo). Fluxo CLARO: os campos de contato so ficam pendentes ate "Salvar";
   o toggle do botao flutuante grava IMEDIATAMENTE (mesmo padrao de AdminFidelidade.toggleEnabled) mas de
   forma TRUTHFUL — so mostra o novo estado se o servidor confirmar; se a escrita falhar, desfaz o toggle
   na tela (nunca mostra um estado que nao persistiu). Valida no cliente (evita round-trip obvio); o
   servidor sempre revalida (is_admin + regras de nome/telefone/whatsapp/email). Estilo alinhado a
   AdminDeliveryEta/AdminFidelidade (admin-card / form-input / btn-primary). */
import { useState, useEffect } from 'react';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { salvarCompanyInfo, formatarTelefoneBR } from '../../services/company/companyInfo.js';
import { normalizePhoneBR } from '../../services/notifications/WhatsAppService.js';

export function AdminEmpresa() {
  const info = useCompanyInfo();              // valor OFICIAL salvo (fonte unica)

  /* ── Campos de contato: SELECAO pendente, so grava no "Salvar". Telefone/whatsapp sao exibidos
     FORMATADOS ((DD) 9NNNN-NNNN) para edicao — o admin pode digitar em qualquer formato (com ou sem
     mascara), o servidor normaliza. "mudou" compara os DIGITOS normalizados (nunca a pontuacao digitada).
     REF-COMPANY-02: nome dividido em nomeCurto (superficies compactas: cabecalho, sidebar do admin,
     login, comanda) e nomeCompleto (titulo do site, documentos) — ver ADR. */
  const [nomeCurto, setNomeCurto] = useState(info.nomeCurto);
  const [nomeCompleto, setNomeCompleto] = useState(info.nomeCompleto);
  const [telefone, setTelefone] = useState(formatarTelefoneBR(info.telefone));
  const [whatsapp, setWhatsapp] = useState(formatarTelefoneBR(info.whatsapp));
  const [email, setEmail] = useState(info.email);
  const [sobre, setSobre] = useState(info.sobre);   // REF-COMPANY-03: texto da tela "Sobre nós"
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);        // { tipo:'ok'|'erro', texto }

  // quando o oficial muda (mount/sync/outro save), os campos refletem o novo oficial
  useEffect(() => {
    setNomeCurto(info.nomeCurto); setNomeCompleto(info.nomeCompleto);
    setTelefone(formatarTelefoneBR(info.telefone));
    setWhatsapp(formatarTelefoneBR(info.whatsapp)); setEmail(info.email);
    setSobre(info.sobre);
  }, [info.nomeCurto, info.nomeCompleto, info.telefone, info.whatsapp, info.email, info.sobre]);

  const mudou = nomeCurto.trim() !== info.nomeCurto
    || nomeCompleto.trim() !== info.nomeCompleto
    || normalizePhoneBR(telefone) !== info.telefone
    || normalizePhoneBR(whatsapp) !== info.whatsapp
    || email.trim().toLowerCase() !== info.email
    || sobre.trim() !== info.sobre;

  const salvar = async () => {
    if (!mudou || salvando) return;
    setSalvando(true); setMsg(null);
    const r = await salvarCompanyInfo({ nomeCurto, nomeCompleto, telefone, whatsapp, email, sobre });
    setSalvando(false);
    if (r.ok) {
      setMsg({ tipo: 'ok', texto: 'Dados da empresa salvos com sucesso.' });
      // reflete o valor CONFIRMADO (normalizado) pelo servidor nos campos
      setNomeCurto(r.info.nomeCurto); setNomeCompleto(r.info.nomeCompleto);
      setTelefone(formatarTelefoneBR(r.info.telefone));
      setWhatsapp(formatarTelefoneBR(r.info.whatsapp)); setEmail(r.info.email);
      setSobre(r.info.sobre);
    } else {
      setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar.' });
    }
  };

  /* ── Toggle do botao flutuante: grava IMEDIATAMENTE, mas TRUTHFUL (desfaz se o servidor recusar) ── */
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
      {/* ── Cabeçalho + status do botão flutuante ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12, marginBottom: 20,
        padding: '16px 20px', background: 'var(--white)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)',
      }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 700, margin: 0 }}>
            🏢 Dados da Empresa
          </h2>
          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
            Botão flutuante do WhatsApp na loja
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: info.whatsappFloatEnabled ? '#15803D' : '#B91C1C',
            background: info.whatsappFloatEnabled ? '#F0FDF4' : '#FEF2F2',
            padding: '4px 12px', borderRadius: 20,
          }}>
            {info.whatsappFloatEnabled ? '🟢 Ativo' : '🔴 Desativado'}
          </span>
          <label className="toggle-switch">
            <input data-testid="empresa-form-wa-float" type="checkbox" checked={info.whatsappFloatEnabled}
              disabled={alternando} onChange={(e) => alternarFloat(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* ── Contato ── */}
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <div className="admin-card-header"><h3>📇 Contato</h3></div>
        <div style={{ padding: '20px' }}>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Nome curto</label>
              <input data-testid="empresa-form-nome-curto" className="form-input" value={nomeCurto}
                onChange={(e) => { setNomeCurto(e.target.value); setMsg(null); }} />
              <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                Cabeçalho da loja, painel admin, login e comanda impressa.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Nome completo</label>
              <input data-testid="empresa-form-nome-completo" className="form-input" value={nomeCompleto}
                onChange={(e) => { setNomeCompleto(e.target.value); setMsg(null); }} />
              <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
                Título do site e documentos.
              </p>
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Telefone principal</label>
              <input data-testid="empresa-form-telefone" className="form-input" placeholder="(47) 99999-9999"
                value={telefone} onChange={(e) => { setTelefone(e.target.value); setMsg(null); }} />
            </div>
            <div className="form-group">
              <label className="form-label">WhatsApp oficial</label>
              <input data-testid="empresa-form-whatsapp" className="form-input" placeholder="(47) 99999-9999"
                value={whatsapp} onChange={(e) => { setWhatsapp(e.target.value); setMsg(null); }} />
            </div>
          </div>
          <div className="form-row" style={{ marginBottom: 20 }}>
            <div className="form-group">
              <label className="form-label">E-mail institucional</label>
              <input data-testid="empresa-form-email" className="form-input" type="email" value={email}
                onChange={(e) => { setEmail(e.target.value); setMsg(null); }} />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 20 }}>
            <label className="form-label">Texto "Sobre nós"</label>
            <textarea data-testid="empresa-form-sobre" className="form-input" rows={6} value={sobre}
              onChange={(e) => { setSobre(e.target.value); setMsg(null); }}
              style={{ resize: 'vertical', lineHeight: 1.6, fontFamily: 'var(--font-body)' }} />
            <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
              Aparece na tela "Sobre nós" da loja. Separe parágrafos deixando uma linha em branco entre eles.
            </p>
          </div>

          <button className="btn-primary" onClick={salvar} disabled={!mudou || salvando} style={{ minWidth: 160 }}>
            {salvando ? 'Salvando…' : '💾 Salvar'}
          </button>
          {msg && (
            <p style={{ fontSize: 13, marginTop: 12, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>
              {msg.texto}
            </p>
          )}

          <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 16, lineHeight: 1.5 }}>
            Estes dados alimentam o botão flutuante, o WhatsApp do checkout e a tela de Contato da loja —
            fonte única, sem necessidade de alterar código.
          </p>
        </div>
      </div>
    </div>
  );
}
