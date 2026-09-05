/* components/admin/AdminMesas.jsx — REF-MESA-02 · Onda 4.
   Aba "Mesas" do Admin (nome já decidido pelo dono do produto). Nesta onda: cadastro/consulta de
   mesas físicas (identificador + status disponível/indisponível) e visualização de ocupação
   (derivada de mesa_session_mesas no servidor, nunca calculada aqui). Ondas futuras adicionam:
   QR, sessão/consulta de conta, lançar pedido, trocar mesa, juntar mesas, fechar conta, histórico,
   impressão — todas nesta mesma tela, por decisão já registrada (seção 18 da autorização). */
import { useState, useEffect, useCallback } from 'react';
import { listarMesas, criarMesa, setMesaStatus, consultarContaMesa, trocarMesaSessao } from '../../services/mesa/mesasFisicas.js';
import { fmt } from '../../utils/format.js';

const STATUS_LABEL = { disponivel: '🟢 Disponível', indisponivel: '⛔ Indisponível' };

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
    setNovaMesaTroca(''); setErroTrocar('');
    const r = await consultarContaMesa(mesa.identificador);
    setContaLoading(false);
    setConta(r);
  };

  const fecharConta = () => { setContaAberta(null); setConta(null); setNovaMesaTroca(''); setErroTrocar(''); };

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

  return (
    <div>
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
              <button className="btn-sm" onClick={fecharConta}>Fechar</button>
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
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
