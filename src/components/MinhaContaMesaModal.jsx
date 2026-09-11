/* components/MinhaContaMesaModal.jsx — REF-MESA-02 · Onda 18.
   Conta acumulada da mesa, SÓ LEITURA (decisão explícita do dono: sem pagamento/divisão pelo cliente
   aqui -- isso continua 100% com o garçom, AdminMesas.jsx). Só existe quando o cliente chegou pelo QR
   real (mesaQrToken) -- consultar_minha_conta_mesa resolve SOMENTE pelo token opaco, nunca pelo número
   da mesa digitado (mesmo motivo de segurança da Onda 5: número é adivinhável). */
import { useEffect, useState, useCallback } from 'react';
import { consultarMinhaContaMesa } from '../services/mesa/mesasFisicas.js';
import { fmt } from '../utils/format.js';

export function MinhaContaMesaModal({ qrToken, onClose }) {
  const [conta, setConta] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    const r = await consultarMinhaContaMesa(qrToken);
    setCarregando(false);
    if (!r.ok) { setErro('Não foi possível carregar sua conta agora.'); return; }
    setConta(r);
  }, [qrToken]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Sua conta na mesa">
        <div className="modal-body">
          <div className="modal-title">🧾 Sua conta{conta?.mesa_identificador ? ` — Mesa ${conta.mesa_identificador}` : ''}</div>

          {carregando ? (
            <p className="modal-desc">Carregando…</p>
          ) : erro ? (
            <p className="modal-desc" role="alert">{erro}</p>
          ) : !conta?.aberta ? (
            <p className="modal-desc">Nenhum pedido em aberto nesta mesa ainda.</p>
          ) : (
            <>
              <div className="modal-section">
                {conta.pedidos.map((p) => (
                  <div key={p.id} style={{ marginBottom: 14, opacity: p.status === 'cancelado' ? 0.5 : 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                      <span>Pedido{p.status === 'cancelado' ? ' (cancelado)' : ''}</span>
                      <span>{fmt(Number(p.total))}</span>
                    </div>
                    {(p.itens || []).map((it, idx) => (
                      <div key={idx} style={{ fontSize: 13, color: 'var(--gray-500)', display: 'flex', justifyContent: 'space-between', paddingLeft: 8 }}>
                        <span>{it.quantity}x {it.nome_produto}{it.adicionais?.length ? ` (+${it.adicionais.length} adicional${it.adicionais.length > 1 ? 'is' : ''})` : ''}</span>
                        <span>{fmt(Number(it.preco_unitario) * Number(it.quantity))}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="modal-price" data-testid="minha-conta-mesa-total" style={{ textAlign: 'right' }}>
                Total: {fmt(Number(conta.total))}
              </div>
              <p className="modal-desc" style={{ marginTop: -8 }}>
                Pediu mais alguma coisa? Chame o garçom quando quiser fechar a conta — ele confirma tudo com você.
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="modal-close" onClick={onClose}>✕</button>
          {!carregando && <button className="btn-primary" onClick={carregar} data-testid="minha-conta-mesa-atualizar">🔄 Atualizar</button>}
        </div>
      </div>
    </div>
  );
}
