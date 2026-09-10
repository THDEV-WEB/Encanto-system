/* components/admin/AdminMesas.jsx — REF-MESA-02 · Onda 4 (+ REF-MESA-01 · Onda 9: bloco de config).
   Aba "Mesas" do Admin (nome já decidido pelo dono do produto). Cadastro/consulta de mesas físicas
   (identificador + status disponível/indisponível), visualização de ocupação (derivada de
   mesa_session_mesas no servidor, nunca calculada aqui), QR, sessão/consulta de conta, trocar/juntar
   mesas, fechar conta — todas nesta mesma tela, por decisão já registrada (seção 18 da autorização).

   Onda 9 fecha o gap registrado desde a REF-MESA-01 (services/mesa/mesaConfig.js, comentário original):
   a loja liga/desliga Mesa (e os 2 canais de pedido) por conta própria — antes só dava via SQL direto.
   Mesmo padrão pendente-com-"Salvar Alterações" do AdminPagamento (não é toggle instantâneo, porque
   os 4 campos são interdependentes: os 3 de baixo só fazem sentido com "habilitada" ligado). */
import { useState, useEffect, useMemo, useCallback } from 'react';
import QRCode from 'qrcode';
import { listarMesas, criarMesa, setMesaStatus, consultarContaMesa, trocarMesaSessao, juntarMesaSessao, fecharContaMesa, obterUrlStorefront } from '../../services/mesa/mesasFisicas.js';
import { useMesaConfig } from '../../hooks/useMesaConfig.js';
import { definirMesaConfig } from '../../services/mesa/mesaConfig.js';
import { fmt } from '../../utils/format.js';
import { printComanda } from './comanda/printComanda.js';

function paraFormConfig(cfg) {
  return { habilitada: !!cfg.habilitada, canalQr: !!cfg.canal_qr, canalAdmin: !!cfg.canal_admin, sessaoHabilitada: !!cfg.sessao_habilitada };
}

function ToggleLinha({ testId, titulo, descricao, checked, disabled, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
      padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 10, opacity: disabled ? 0.5 : 1,
    }}>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gray-700)' }}>{titulo}</div>
        {descricao && <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>{descricao}</div>}
      </div>
      <label className="toggle-switch">
        <input data-testid={testId} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

function ConfigMesa() {
  const oficial = useMesaConfig();
  const [form, setForm] = useState(() => paraFormConfig(oficial));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null); // { tipo:'ok'|'erro', texto }

  const oficialKey = useMemo(() => JSON.stringify(paraFormConfig(oficial)), [oficial]);
  useEffect(() => { setForm(paraFormConfig(oficial)); }, [oficialKey]);

  const mudou = oficialKey !== JSON.stringify(form);
  const podeSalvar = mudou && !salvando;

  const marcar = (campo) => (e) => {
    const v = e.target.checked;
    setMsg(null);
    setForm((f) => {
      const novo = { ...f, [campo]: v };
      // desligar "habilitada" desliga os 3 canais junto (nunca fica um canal ligado sem Mesa habilitada).
      if (campo === 'habilitada' && !v) return { habilitada: false, canalQr: false, canalAdmin: false, sessaoHabilitada: false };
      return novo;
    });
  };

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true); setMsg(null);
    const r = await definirMesaConfig(form);
    setSalvando(false);
    if (r.ok) setMsg({ tipo: 'ok', texto: 'Configuração de Mesa salva com sucesso.' });
    else setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar.' });
  };

  return (
    <div className="admin-card" style={{ marginBottom: 20 }}>
      <div className="admin-card-header"><h3>⚙️ Configuração de Mesa</h3></div>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ToggleLinha
          testId="mesa-config-toggle-habilitada" checked={form.habilitada}
          titulo="Atendimento por Mesa" descricao="Com desligado, a loja atende só entrega/retirada — o cliente nunca vê a opção Mesa."
          onChange={marcar('habilitada')}
        />
        <ToggleLinha
          testId="mesa-config-toggle-canal-qr" checked={form.canalQr} disabled={!form.habilitada}
          titulo="Autoatendimento por QR Code" descricao="O cliente escaneia o QR na própria mesa e faz o pedido sozinho — o garçom só confirma/entrega."
          onChange={marcar('canalQr')}
        />
        <ToggleLinha
          testId="mesa-config-toggle-canal-admin" checked={form.canalAdmin} disabled={!form.habilitada}
          titulo="Lançamento manual pelo garçom" descricao="O garçom registra o pedido da mesa pelo Admin, sem depender do cliente usar QR nenhum."
          onChange={marcar('canalAdmin')}
        />
        <ToggleLinha
          testId="mesa-config-toggle-sessao" checked={form.sessaoHabilitada} disabled={!form.habilitada}
          titulo="Conta por sessão de mesa" descricao="Agrupa vários pedidos da mesma mesa numa única conta (trocar/juntar mesas, fechar tudo junto)."
          onChange={marcar('sessaoHabilitada')}
        />
        {form.habilitada && !form.canalQr && !form.canalAdmin && (
          <p style={{ fontSize: 12.5, color: '#B45309', fontWeight: 600, margin: 0 }}>
            ⚠️ Mesa está ligada, mas nenhum canal de pedido (QR ou garçom) está ativo — o cliente não vai conseguir pedir por mesa ainda.
          </p>
        )}
        <div style={{ textAlign: 'right', marginTop: 4 }}>
          <button className="btn-primary" onClick={salvar} disabled={!podeSalvar} data-testid="mesa-config-salvar-btn">
            💾 {salvando ? 'Salvando…' : 'Salvar Alterações'}
          </button>
          {!mudou && !msg && <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 8 }}>Nenhuma alteração pendente.</p>}
          {msg && (
            <p data-testid="mesa-config-msg" style={{ fontSize: 13, marginTop: 8, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL = { disponivel: '🟢 Disponível', indisponivel: '⛔ Indisponível' };
// Mesmas 4 formas de pagamento de NovoPedidoMesaModal.jsx (REF-MESA-02 · Onda 7) -- nao inventa
// um novo conjunto.
const PAGAMENTOS = [
  { id: 'dinheiro', label: 'Dinheiro' }, { id: 'pix', label: 'PIX' },
  { id: 'cartao_debito', label: 'Débito' }, { id: 'cartao_credito', label: 'Crédito' },
];

export function AdminMesas() {
  const [mesas, setMesas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [novoIdentificador, setNovoIdentificador] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');
  const [alterando, setAlterando] = useState(null); // id da mesa com toggle em voo (evita duplo clique)
  const [contaAberta, setContaAberta] = useState(null); // identificador da mesa com o modal de conta aberto
  const [conta, setConta] = useState(null);
  const [contaLoading, setContaLoading] = useState(false);
  const [novaMesaTroca, setNovaMesaTroca] = useState('');
  const [trocando, setTrocando] = useState(false);
  const [erroTrocar, setErroTrocar] = useState('');
  const [novaMesaJuntar, setNovaMesaJuntar] = useState('');
  const [juntando, setJuntando] = useState(false);
  const [erroJuntar, setErroJuntar] = useState('');
  const [pagamentoFechar, setPagamentoFechar] = useState('dinheiro');
  const [fechando, setFechando] = useState(false);
  const [erroFechar, setErroFechar] = useState('');
  const [qrAberta, setQrAberta] = useState(null); // mesa (objeto) com o modal de QR aberto
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrLink, setQrLink] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrErro, setQrErro] = useState('');
  const [urlLojaCache, setUrlLojaCache] = useState(null); // evita rechamar a RPC a cada mesa aberta

  const recarregar = useCallback(async () => {
    setLoading(true);
    const r = await listarMesas();
    setMesas(r);
    setLoading(false);
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const onCriar = async () => {
    const id = novoIdentificador.trim();
    if (!id || criando) return;
    setCriando(true); setErroCriar('');
    const r = await criarMesa(id);
    setCriando(false);
    if (!r.ok) {
      setErroCriar(r.error === 'mesa ja cadastrada' ? 'Já existe uma mesa com esse número/nome.' : (r.error === 'sem permissao' ? 'Sem permissão de administrador.' : 'Não foi possível cadastrar.'));
      return;
    }
    setNovoIdentificador('');
    recarregar();
  };

  const onToggleStatus = async (mesa) => {
    if (alterando) return;
    const novo = mesa.status === 'disponivel' ? 'indisponivel' : 'disponivel';
    setAlterando(mesa.id);
    const r = await setMesaStatus(mesa.id, novo);
    setAlterando(null);
    if (r.ok) recarregar();
  };

  const onVerConta = async (mesa) => {
    setContaAberta(mesa.identificador);
    setContaLoading(true);
    setConta(null);
    setNovaMesaTroca(''); setErroTrocar(''); setNovaMesaJuntar(''); setErroJuntar('');
    setPagamentoFechar('dinheiro'); setErroFechar('');
    const r = await consultarContaMesa(mesa.identificador);
    setContaLoading(false);
    setConta(r);
  };

  const fecharModalConta = () => {
    setContaAberta(null); setConta(null);
    setNovaMesaTroca(''); setErroTrocar('');
    setNovaMesaJuntar(''); setErroJuntar('');
    setPagamentoFechar('dinheiro'); setErroFechar('');
  };

  const onVerQr = async (mesa) => {
    setQrAberta(mesa);
    setQrLoading(true); setQrErro(''); setQrDataUrl(null); setQrLink('');
    let base = urlLojaCache;
    if (!base) {
      const r = await obterUrlStorefront();
      if (!r.ok) { setQrLoading(false); setQrErro('Não foi possível obter a URL da loja.'); return; }
      base = r.url;
      setUrlLojaCache(base);
    }
    const link = `${base}/?mesa_token=${mesa.qr_token}`;
    setQrLink(link);
    try {
      const dataUrl = await QRCode.toDataURL(link, { width: 320, margin: 2 });
      setQrDataUrl(dataUrl);
    } catch {
      setQrErro('Não foi possível gerar o QR.');
    }
    setQrLoading(false);
  };

  const fecharQr = () => { setQrAberta(null); setQrDataUrl(null); setQrLink(''); setQrErro(''); };

  const onImprimirQr = () => {
    if (!qrDataUrl || !qrAberta) return;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>QR Mesa ${qrAberta.identificador}</title>
      <style>
        body{font-family:sans-serif;text-align:center;padding:40px;}
        h1{font-size:28px;margin-bottom:4px;}
        img{width:280px;height:280px;margin:24px 0;}
        p{font-size:13px;color:#555;word-break:break-all;}
      </style></head>
      <body>
        <h1>Mesa ${qrAberta.identificador}</h1>
        <p>Aponte a câmera do celular para o código e faça seu pedido</p>
        <img src="${qrDataUrl}" alt="QR da mesa ${qrAberta.identificador}" />
      </body></html>`;
    printComanda(html);
  };

  const onTrocarMesa = async () => {
    if (!novaMesaTroca || !conta?.sessao_id || trocando) return;
    setTrocando(true); setErroTrocar('');
    const r = await trocarMesaSessao(conta.sessao_id, novaMesaTroca);
    setTrocando(false);
    if (!r.ok) {
      setErroTrocar(r.error === 'mesa ja ocupada' ? 'Essa mesa já está ocupada.' : r.error === 'mesa indisponivel' ? 'Essa mesa está indisponível.' : 'Não foi possível trocar de mesa.');
      return;
    }
    setNovaMesaTroca('');
    await recarregar();
    setContaAberta(r.para);
    setContaLoading(true);
    const novaConta = await consultarContaMesa(r.para);
    setContaLoading(false);
    setConta(novaConta);
  };

  const onJuntarMesa = async () => {
    if (!novaMesaJuntar || !conta?.sessao_id || juntando) return;
    setJuntando(true); setErroJuntar('');
    const r = await juntarMesaSessao(conta.sessao_id, novaMesaJuntar);
    setJuntando(false);
    if (!r.ok) {
      setErroJuntar(r.error === 'mesa ja ocupada' ? 'Essa mesa já está ocupada.' : r.error === 'mesa indisponivel' ? 'Essa mesa está indisponível.' : 'Não foi possível juntar a mesa.');
      return;
    }
    setNovaMesaJuntar('');
    await recarregar();
    setContaLoading(true);
    const novaConta = await consultarContaMesa(contaAberta);
    setContaLoading(false);
    setConta(novaConta);
  };

  const onFecharConta = async () => {
    if (!conta?.sessao_id || fechando) return;
    setFechando(true); setErroFechar('');
    const r = await fecharContaMesa(conta.sessao_id, pagamentoFechar);
    setFechando(false);
    if (!r.ok) {
      setErroFechar(r.error === 'forma de pagamento obrigatoria' ? 'Selecione a forma de pagamento.' : 'Não foi possível fechar a conta.');
      return;
    }
    fecharModalConta();
    recarregar();
  };

  return (
    <div>
      <ConfigMesa/>

      <div className="admin-card" style={{ marginBottom: 20 }}>
        <div className="admin-card-header"><h3>🪑 Cadastrar mesa</h3></div>
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              className="form-input" style={{ flex: 1, minWidth: 160 }}
              placeholder="Número ou nome da mesa (ex.: 05, VIP)"
              value={novoIdentificador}
              onChange={(e) => setNovoIdentificador(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onCriar(); }}
              maxLength={40}
              data-testid="mesas-novo-identificador"
            />
            <button className="btn-primary" onClick={onCriar} disabled={criando || !novoIdentificador.trim()} style={{ minWidth: 140 }} data-testid="mesas-criar-btn">
              {criando ? 'Cadastrando…' : '+ Cadastrar mesa'}
            </button>
          </div>
          {erroCriar && <p style={{ fontSize: 13, color: '#DC2626', marginTop: 8, fontWeight: 600 }}>{erroCriar}</p>}
        </div>
      </div>

      <div className="admin-card">
        <div className="admin-card-header"><h3>📋 Mesas cadastradas ({mesas.length})</h3></div>
        <div style={{ padding: loading || mesas.length === 0 ? 20 : 0 }}>
          {loading ? (
            <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>Carregando…</p>
          ) : mesas.length === 0 ? (
            <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>Nenhuma mesa cadastrada ainda.</p>
          ) : (
            mesas.map((m) => (
              <div key={m.id} data-testid={`mesa-linha-${m.identificador}`} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '14px 20px', borderBottom: '1px solid var(--gray-100)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>Mesa {m.identificador}</span>
                  {m.ocupada && (
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#B45309', background: '#FEF3C7', padding: '3px 10px', borderRadius: 20 }}>
                      🍽️ Ocupada agora
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: m.status === 'disponivel' ? '#15803D' : 'var(--gray-500)' }}>
                    {STATUS_LABEL[m.status] || m.status}
                  </span>
                  {m.ocupada && (
                    <button className="btn-sm" onClick={() => onVerConta(m)} data-testid={`mesa-ver-conta-${m.identificador}`}>
                      🧾 Ver conta
                    </button>
                  )}
                  <button className="btn-sm" onClick={() => onVerQr(m)} data-testid={`mesa-ver-qr-${m.identificador}`}>
                    🔲 QR
                  </button>
                  <button className="btn-sm" disabled={alterando === m.id} onClick={() => onToggleStatus(m)} data-testid={`mesa-toggle-${m.identificador}`}>
                    {alterando === m.id ? '…' : (m.status === 'disponivel' ? 'Marcar indisponível' : 'Marcar disponível')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {contaAberta && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} data-testid="conta-mesa-dialog">
          <div className="admin-card" style={{ width: 420, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }}>
            <div className="admin-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>🧾 Conta — Mesa {contaAberta}</h3>
              <button className="btn-sm" onClick={fecharModalConta}>Fechar</button>
            </div>
            <div style={{ padding: 20 }}>
              {contaLoading ? (
                <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>Carregando…</p>
              ) : !conta?.ok ? (
                <p style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>
                  {conta?.error === 'mesa nao encontrada' ? 'Mesa não encontrada.' : 'Não foi possível consultar a conta.'}
                </p>
              ) : !conta.aberta ? (
                <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>Esta mesa não tem sessão aberta no momento.</p>
              ) : (
                <>
                  {conta.mesas?.length > 1 && (
                    <p style={{ fontSize: 12.5, color: 'var(--gray-500)', marginBottom: 10 }}>
                      Mesas nesta sessão: {conta.mesas.join(', ')}
                    </p>
                  )}
                  {conta.pedidos.map((p) => (
                    <div key={p.id} style={{ marginBottom: 14, opacity: p.status === 'cancelado' ? 0.5 : 1 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Pedido {p.status === 'cancelado' ? '(cancelado)' : ''}</span>
                        <span>{fmt(Number(p.total))}</span>
                      </div>
                      {(p.itens || []).map((it, idx) => (
                        <div key={idx} style={{ fontSize: 12.5, color: 'var(--gray-600)', display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
                          <span>{it.quantity}x {it.nome_produto}{it.adicionais?.length ? ` (+${it.adicionais.length} adicional${it.adicionais.length > 1 ? 'is' : ''})` : ''}</span>
                          <span>{fmt(Number(it.preco_unitario) * Number(it.quantity))}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid var(--gray-100)', marginTop: 10, paddingTop: 10, textAlign: 'right', fontWeight: 800, fontSize: 15 }} data-testid="conta-mesa-total">
                    Total: {fmt(Number(conta.total))}
                  </div>

                  <div style={{ borderTop: '1px solid var(--gray-100)', marginTop: 14, paddingTop: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>🔀 Trocar de mesa</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        className="form-input" style={{ flex: 1 }}
                        value={novaMesaTroca}
                        onChange={(e) => setNovaMesaTroca(e.target.value)}
                        data-testid="conta-mesa-trocar-select"
                      >
                        <option value="">Selecione a mesa destino…</option>
                        {mesas.filter((m) => m.status === 'disponivel' && !m.ocupada && m.identificador !== contaAberta).map((m) => (
                          <option key={m.id} value={m.identificador}>Mesa {m.identificador}</option>
                        ))}
                      </select>
                      <button className="btn-sm" disabled={!novaMesaTroca || trocando} onClick={onTrocarMesa} data-testid="conta-mesa-trocar-btn">
                        {trocando ? '…' : 'Trocar'}
                      </button>
                    </div>
                    {erroTrocar && <p style={{ fontSize: 12.5, color: '#DC2626', marginTop: 6, fontWeight: 600 }}>{erroTrocar}</p>}
                  </div>

                  <div style={{ borderTop: '1px solid var(--gray-100)', marginTop: 14, paddingTop: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>➕ Juntar mesa</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        className="form-input" style={{ flex: 1 }}
                        value={novaMesaJuntar}
                        onChange={(e) => setNovaMesaJuntar(e.target.value)}
                        data-testid="conta-mesa-juntar-select"
                      >
                        <option value="">Selecione a mesa a juntar…</option>
                        {mesas.filter((m) => m.status === 'disponivel' && !m.ocupada && !(conta.mesas || []).includes(m.identificador)).map((m) => (
                          <option key={m.id} value={m.identificador}>Mesa {m.identificador}</option>
                        ))}
                      </select>
                      <button className="btn-sm" disabled={!novaMesaJuntar || juntando} onClick={onJuntarMesa} data-testid="conta-mesa-juntar-btn">
                        {juntando ? '…' : 'Juntar'}
                      </button>
                    </div>
                    {erroJuntar && <p style={{ fontSize: 12.5, color: '#DC2626', marginTop: 6, fontWeight: 600 }}>{erroJuntar}</p>}
                  </div>

                  <div style={{ borderTop: '1px solid var(--gray-100)', marginTop: 14, paddingTop: 14 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>✅ Fechar conta</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {PAGAMENTOS.map((o) => (
                        <button
                          key={o.id} type="button"
                          onClick={() => setPagamentoFechar(o.id)}
                          data-testid={`conta-mesa-pagamento-${o.id}`}
                          style={{
                            padding: '6px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, border: 'none', cursor: 'pointer',
                            background: pagamentoFechar === o.id ? '#A62786' : '#F1EADF',
                            color: pagamentoFechar === o.id ? '#fff' : '#6B5D50',
                          }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <button className="btn-primary" style={{ marginTop: 10, width: '100%' }} disabled={fechando} onClick={onFecharConta} data-testid="conta-mesa-fechar-btn">
                      {fechando ? 'Fechando…' : `Fechar conta — ${fmt(Number(conta.total))}`}
                    </button>
                    {erroFechar && <p style={{ fontSize: 12.5, color: '#DC2626', marginTop: 6, fontWeight: 600 }}>{erroFechar}</p>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {qrAberta && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} data-testid="qr-mesa-dialog">
          <div className="admin-card" style={{ width: 380, maxWidth: '92vw', textAlign: 'center' }}>
            <div className="admin-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>🔲 QR — Mesa {qrAberta.identificador}</h3>
              <button className="btn-sm" onClick={fecharQr}>Fechar</button>
            </div>
            <div style={{ padding: 20 }}>
              {qrLoading ? (
                <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>Gerando…</p>
              ) : qrErro ? (
                <p style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>{qrErro}</p>
              ) : (
                <>
                  <img src={qrDataUrl} alt={`QR da mesa ${qrAberta.identificador}`} style={{ width: 220, height: 220 }} data-testid="qr-mesa-imagem" />
                  <p style={{ fontSize: 11.5, color: 'var(--gray-500)', wordBreak: 'break-all', marginTop: 10 }} data-testid="qr-mesa-link">{qrLink}</p>
                  <button className="btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={onImprimirQr} data-testid="qr-mesa-imprimir-btn">
                    🖨️ Imprimir
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
