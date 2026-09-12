/* components/admin/PlatformFaturamento.jsx — REF-BILLING-01 · Onda 3.
   Aba "Faturamento" do Platform Console: lista todas as lojas com o status real de assinatura
   (store_subscriptions, ver Onda 1/2) e, por loja, as 3 acoes exclusivas do Platform Admin --
   configurar dia de vencimento, configurar contato financeiro, marcar mensalidade paga -- alem do
   historico/auditoria (store_billing_events). NUNCA duplica o Admin da loja nem o resto do Platform
   Console -- so supervisao/gestao de cobranca, mesmo espirito de PlatformTenants.jsx (que este arquivo
   copia estruturalmente: lista + "Ver detalhe" expandindo um painel por loja).

   Escrita SEMPRE exclusiva do Platform Admin (RPCs platform_configurar_dia_vencimento/
   platform_configurar_contato_financeiro/platform_marcar_mensalidade_paga -- is_super_admin no
   servidor, nunca confiado so' no frontend). Leitura (platform_list_billing/get_billing_status)
   tambem funciona pro admin da PROPRIA loja -- reaproveitada sem mudanca pela Onda 4 (ainda nao
   autorizada) quando ela precisar do mesmo get_billing_status em modo so-leitura. */
import { useEffect, useState, useCallback } from 'react';
import { DS } from '../../services/DataService.js';
import { fmt, fmtDataCalendario, fmtDataHoraLoja } from '../../utils/format.js';

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

const CORES_STATUS_BILLING = {
  em_dia:          { bg: '#F0FDF4', fg: '#15803D', ponto: '🟢', texto: 'Em dia' },
  carencia:        { bg: '#FEF9C3', fg: '#854D0E', ponto: '🟡', texto: 'Carência' },
  bloqueada:       { bg: '#FEF2F2', fg: '#B91C1C', ponto: '🔴', texto: 'Bloqueada' },
  isenta:          { bg: '#EFF6FF', fg: '#1D4ED8', ponto: '🔵', texto: 'Isenta' },
  sem_assinatura:  { bg: '#F3F4F6', fg: '#6B7280', ponto: '⚪', texto: 'Sem assinatura' },
};
function statusBilling(status) { return CORES_STATUS_BILLING[status] || CORES_STATUS_BILLING.sem_assinatura; }

const ROTULOS_EVENTO = {
  mensalidade_gerada: 'Mensalidade gerada',
  vencimento: 'Vencimento atingido',
  pagamento_confirmado: 'Pagamento confirmado',
  alteracao_vencimento: 'Dia de vencimento alterado',
  entrada_carencia: 'Entrou em carência',
  bloqueio: 'Bloqueado',
  isencao: 'Marcado como isento',
};

function Historico({ eventos }) {
  if (!eventos || eventos.length === 0) {
    return <p style={{ fontSize: 12.5, color: 'var(--gray-400)' }}>Nenhum evento registrado ainda.</p>;
  }
  return (
    <div>
      {eventos.map((ev, i) => (
        <div key={i} style={{ padding: '6px 0', borderBottom: i < eventos.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{ROTULOS_EVENTO[ev.tipo] || ev.tipo}</div>
          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{fmtDataHoraLoja(ev.created_at)}</div>
        </div>
      ))}
    </div>
  );
}

function DetalheFaturamento({ loja, onFechar, onMudou }) {
  const [detalhe, setDetalhe] = useState(null);
  const [erro, setErro] = useState(null);

  const [dia, setDia] = useState('');
  const [salvandoDia, setSalvandoDia] = useState(false);
  const [msgDia, setMsgDia] = useState(null);

  const [nomeContato, setNomeContato] = useState('');
  const [emailContato, setEmailContato] = useState('');
  const [whatsappContato, setWhatsappContato] = useState('');
  const [salvandoContato, setSalvandoContato] = useState(false);
  const [msgContato, setMsgContato] = useState(null);

  const [novoVencimento, setNovoVencimento] = useState('');
  const [marcando, setMarcando] = useState(false);
  const [msgMarcar, setMsgMarcar] = useState(null);

  const carregar = useCallback(() => {
    DS.getBillingStatus(loja.store_id).then((d) => {
      setDetalhe(d);
      setDia(d.dia_vencimento != null ? String(d.dia_vencimento) : '');
      setNomeContato(d.contato_financeiro_nome || '');
      setEmailContato(d.contato_financeiro_email || '');
      setWhatsappContato(d.contato_financeiro_whatsapp || '');
    }).catch((e) => setErro(e?.message));
  }, [loja.store_id]);

  useEffect(() => { carregar(); }, [carregar]);

  const recarregarTudo = () => { carregar(); onMudou?.(); };

  const salvarDia = async () => {
    const n = Number(dia);
    if (salvandoDia || !Number.isInteger(n) || n < 1 || n > 31) return;
    setSalvandoDia(true); setMsgDia(null);
    try {
      await DS.platformConfigurarDiaVencimento(loja.store_id, n);
      setMsgDia({ tipo: 'ok', texto: 'Dia de vencimento salvo.' });
      recarregarTudo();
    } catch (e) {
      setMsgDia({ tipo: 'erro', texto: e?.message || 'Não foi possível salvar.' });
    } finally {
      setSalvandoDia(false);
    }
  };

  const salvarContato = async () => {
    if (salvandoContato) return;
    setSalvandoContato(true); setMsgContato(null);
    try {
      await DS.platformConfigurarContatoFinanceiro(loja.store_id, nomeContato.trim(), emailContato.trim(), whatsappContato.trim());
      setMsgContato({ tipo: 'ok', texto: 'Contato financeiro salvo.' });
      recarregarTudo();
    } catch (e) {
      setMsgContato({ tipo: 'erro', texto: e?.message || 'Não foi possível salvar.' });
    } finally {
      setSalvandoContato(false);
    }
  };

  const marcarPago = async () => {
    if (!novoVencimento || marcando) return;
    if (!window.confirm(`Confirmar pagamento de ${fmt(detalhe.valor_devido)} de "${loja.nome}"? O próximo vencimento passa a ser ${fmtDataCalendario(novoVencimento)}.`)) return;
    setMarcando(true); setMsgMarcar(null);
    try {
      await DS.platformMarcarMensalidadePaga(loja.store_id, novoVencimento);
      setMsgMarcar({ tipo: 'ok', texto: 'Pagamento confirmado.' });
      setNovoVencimento('');
      recarregarTudo();
    } catch (e) {
      setMsgMarcar({ tipo: 'erro', texto: e?.message || 'Não foi possível confirmar o pagamento.' });
    } finally {
      setMarcando(false);
    }
  };

  if (erro) return <p style={{ fontSize: 13, color: 'var(--red)' }}>{erro}</p>;
  if (!detalhe) return <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Carregando detalhe…</p>;

  const status = statusBilling(detalhe.status);

  return (
    <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 12, paddingTop: 16 }} data-testid={`plataforma-faturamento-detalhe-${loja.slug}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>📋 Situação atual</h4>
          <p style={{ fontSize: 12.5, color: 'var(--gray-600)', lineHeight: 1.9 }}>
            Status: <span style={{ fontWeight: 700, color: status.fg }}>{status.ponto} {status.texto}</span><br/>
            Mensalidade: {fmt(detalhe.valor_devido ?? 99)}<br/>
            Próximo vencimento: {fmtDataCalendario(detalhe.proximo_vencimento)}<br/>
            {detalhe.trial_ate && <>Trial até: {fmtDataCalendario(detalhe.trial_ate)}<br/></>}
          </p>

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>📅 Dia de vencimento</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" type="number" min="1" max="31" placeholder="dia do mês (1-31)"
              value={dia} data-testid={`plataforma-faturamento-dia-input-${loja.slug}`}
              onChange={(e) => { setDia(e.target.value); setMsgDia(null); }} style={{ flex: 1 }} />
            <button className="btn-secondary" onClick={salvarDia}
              disabled={salvandoDia || !Number.isInteger(Number(dia)) || Number(dia) < 1 || Number(dia) > 31}
              data-testid={`plataforma-faturamento-dia-salvar-${loja.slug}`}>
              {salvandoDia ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
            Alterar o dia nunca muda o próximo vencimento já agendado -- só passa a valer a partir do vencimento seguinte.
          </p>
          {msgDia && <p style={{ fontSize: 12.5, marginTop: 6, fontWeight: 600, color: msgDia.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msgDia.texto}</p>}

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>💰 Confirmar pagamento</h4>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="form-input" type="date"
              value={novoVencimento} data-testid={`plataforma-faturamento-marcar-data-${loja.slug}`}
              onChange={(e) => { setNovoVencimento(e.target.value); setMsgMarcar(null); }} style={{ flex: 1 }} />
            <button className="btn-primary" onClick={marcarPago} disabled={marcando || !novoVencimento}
              data-testid={`plataforma-faturamento-marcar-btn-${loja.slug}`}>
              {marcando ? 'Confirmando…' : '✅ Marcar pago'}
            </button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
            Escolha a data do PRÓXIMO vencimento (depois deste pagamento) -- o recebimento em si continua manual, fora do sistema.
          </p>
          {msgMarcar && <p style={{ fontSize: 12.5, marginTop: 6, fontWeight: 600, color: msgMarcar.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msgMarcar.texto}</p>}
        </div>

        <div>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>👤 Contato financeiro</h4>
          <p style={{ fontSize: 11.5, color: 'var(--gray-400)', marginBottom: 8 }}>
            Dedicado -- dono/gerente que recebe os avisos de vencimento, nunca o contato público da loja.
          </p>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">Nome</label>
            <input className="form-input" value={nomeContato} data-testid={`plataforma-faturamento-contato-nome-${loja.slug}`}
              onChange={(e) => { setNomeContato(e.target.value); setMsgContato(null); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">E-mail</label>
            <input className="form-input" type="email" value={emailContato} data-testid={`plataforma-faturamento-contato-email-${loja.slug}`}
              onChange={(e) => { setEmailContato(e.target.value); setMsgContato(null); }} />
          </div>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label className="form-label">WhatsApp</label>
            <input className="form-input" value={whatsappContato} data-testid={`plataforma-faturamento-contato-whatsapp-${loja.slug}`}
              onChange={(e) => { setWhatsappContato(e.target.value); setMsgContato(null); }} />
          </div>
          <button className="btn-secondary" onClick={salvarContato} disabled={salvandoContato}
            data-testid={`plataforma-faturamento-contato-salvar-${loja.slug}`}>
            {salvandoContato ? 'Salvando…' : 'Salvar contato'}
          </button>
          {msgContato && <p style={{ fontSize: 12.5, marginTop: 6, fontWeight: 600, color: msgContato.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msgContato.texto}</p>}

          <h4 style={{ fontSize: 13, fontWeight: 700, margin: '16px 0 8px' }}>🧾 Histórico</h4>
          <Historico eventos={detalhe.historico} />
        </div>
      </div>
      <button className="btn-secondary" onClick={onFechar} style={{ marginTop: 16 }}>Fechar detalhe</button>
    </div>
  );
}

function LinhaFaturamento({ loja, aberta, onAlternarDetalhe, onMudou }) {
  const status = statusBilling(loja.status);
  return (
    <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, padding: 14, marginBottom: 12 }} data-testid={`plataforma-faturamento-linha-${loja.slug}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>{loja.nome}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-500)' }}>
            /{loja.slug} · {fmt(loja.valor_devido ?? 99)} · vence {fmtDataCalendario(loja.proximo_vencimento)}
          </div>
        </div>
        <span data-testid={`plataforma-faturamento-status-${loja.slug}`} style={{ fontSize: 11.5, fontWeight: 700, color: status.fg, background: status.bg, padding: '3px 10px', borderRadius: 20 }}>
          {status.ponto} {status.texto}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn-secondary" onClick={() => onAlternarDetalhe(loja.store_id)} data-testid={`plataforma-faturamento-ver-detalhe-${loja.slug}`}>
          {aberta ? 'Ocultar detalhe' : 'Ver detalhe'}
        </button>
      </div>
      {aberta && <DetalheFaturamento loja={loja} onFechar={() => onAlternarDetalhe(loja.store_id)} onMudou={onMudou} />}
    </div>
  );
}

export function PlatformFaturamento() {
  const [lojas, setLojas] = useState(null);
  const [erro, setErro] = useState(null);
  const [detalheAberto, setDetalheAberto] = useState(null);

  const carregar = useCallback(() => {
    DS.platformListBilling().then(setLojas).catch((e) => setErro(e?.message || 'Não foi possível carregar o faturamento.'));
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (erro) return <p style={{ fontSize: 13, color: 'var(--red)' }}>{erro}</p>;

  return (
    <Bloco icone="💳" titulo={`Faturamento (${lojas?.length ?? '…'})`} descricao="Mensalidade das lojas na plataforma -- cobrança assistida: o sistema controla valor/vencimento/status, o recebimento em si continua manual (Pix por fora).">
      {lojas && lojas.length === 0 && <p style={{ fontSize: 13, color: 'var(--gray-400)' }}>Nenhuma loja encontrada.</p>}
      {lojas?.map((loja) => (
        <LinhaFaturamento
          key={loja.store_id}
          loja={loja}
          aberta={detalheAberto === loja.store_id}
          onAlternarDetalhe={(id) => setDetalheAberto((atual) => (atual === id ? null : id))}
          onMudou={carregar}
        />
      ))}
    </Bloco>
  );
}
