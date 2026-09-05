/* components/admin/AdminMesas.jsx — REF-MESA-02 · Onda 4.
   Aba "Mesas" do Admin (nome já decidido pelo dono do produto). Nesta onda: cadastro/consulta de
   mesas físicas (identificador + status disponível/indisponível) e visualização de ocupação
   (derivada de mesa_session_mesas no servidor, nunca calculada aqui). Ondas futuras adicionam:
   QR, sessão/consulta de conta, lançar pedido, trocar mesa, juntar mesas, fechar conta, histórico,
   impressão — todas nesta mesma tela, por decisão já registrada (seção 18 da autorização). */
import { useState, useEffect, useCallback } from 'react';
import { listarMesas, criarMesa, setMesaStatus } from '../../services/mesa/mesasFisicas.js';

const STATUS_LABEL = { disponivel: '🟢 Disponível', indisponivel: '⛔ Indisponível' };

export function AdminMesas() {
  const [mesas, setMesas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [novoIdentificador, setNovoIdentificador] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');
  const [alterando, setAlterando] = useState(null); // id da mesa com toggle em voo (evita duplo clique)

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
                  <button className="btn-sm" disabled={alterando === m.id} onClick={() => onToggleStatus(m)} data-testid={`mesa-toggle-${m.identificador}`}>
                    {alterando === m.id ? '…' : (m.status === 'disponivel' ? 'Marcar indisponível' : 'Marcar disponível')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
