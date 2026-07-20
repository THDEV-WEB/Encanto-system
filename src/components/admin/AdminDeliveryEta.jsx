/* components/admin/AdminDeliveryEta.jsx — REF-DELIVERY-01.
   Controle administrativo do TEMPO ESTIMADO DE ENTREGA (minutos). FONTE UNICA no Supabase (settings via RPC
   set_delivery_eta). Consome o MESMO valor que a loja (useDeliveryEta) — nao recalcula nem duplica. Valida
   10..180 tambem no cliente (o servidor revalida: is_admin + faixa). Otimista via definirEta -> a loja
   (DeliveryBar) e a confirmacao (SuccessPage) refletem pelo ETA_EVENT. Estilo alinhado ao AdminStatus. */
import { useState, useEffect } from 'react';
import { useDeliveryEta } from '../../hooks/useDeliveryEta.js';
import { definirEta, ETA_MIN, ETA_MAX } from '../../services/delivery/deliveryEta.js';

const PRESETS = [30, 35, 40, 45, 50, 60];

export function AdminDeliveryEta() {
  const etaAtual = useDeliveryEta();
  const [valor, setValor] = useState(String(etaAtual));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);   // { tipo:'ok'|'erro', texto }

  // reflete o valor oficial quando ele muda (mount/sync/outro dispositivo)
  useEffect(() => { setValor(String(etaAtual)); }, [etaAtual]);

  const n = parseInt(valor, 10);
  const valido = Number.isFinite(n) && n >= ETA_MIN && n <= ETA_MAX;
  const mudou = valido && n !== etaAtual;

  const salvar = async (alvo) => {
    const v = Number.isFinite(alvo) ? alvo : n;
    if (!Number.isFinite(v) || v < ETA_MIN || v > ETA_MAX || salvando) return;
    setSalvando(true); setMsg(null);
    const r = await definirEta(v);
    setSalvando(false);
    if (r.ok) setMsg({ tipo: 'ok', texto: `Salvo: ${r.eta} minutos.` });
    else setMsg({ tipo: 'erro', texto: r.error === 'offline'
      ? 'Sem conexão — tente novamente.'
      : (r.error || 'Não foi possível salvar. Verifique seu acesso de administrador.') });
  };

  return (
    <div className="admin-card" style={{ marginBottom: 20 }}>
      <div className="admin-card-header"><h3>🛵 Tempo de Entrega</h3></div>
      <div style={{ padding: '24px 20px' }}>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 16 }}>
          Tempo estimado de entrega exibido na loja e na confirmação do pedido. Aceita apenas números entre{' '}
          <strong>{ETA_MIN}</strong> e <strong>{ETA_MAX}</strong> minutos.
        </p>

        {/* Atalhos rapidos — clique salva direto */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {PRESETS.map((p) => {
            const ativo = p === etaAtual;
            return (
              <button key={p} onClick={() => { setValor(String(p)); salvar(p); }} disabled={salvando}
                style={{
                  padding: '8px 14px', borderRadius: 999, cursor: salvando ? 'default' : 'pointer',
                  border: ativo ? '2px solid var(--grape)' : '1.5px solid var(--gray-200)',
                  background: ativo ? 'var(--grape-pale)' : 'var(--white)',
                  color: ativo ? 'var(--grape)' : 'var(--gray-700)',
                  fontWeight: 700, fontSize: 13, fontFamily: 'var(--font-body)',
                }}>{p} min</button>
            );
          })}
        </div>

        {/* Valor exato + salvar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input type="number" min={ETA_MIN} max={ETA_MAX} step={5} value={valor}
            onChange={(e) => { setValor(e.target.value); setMsg(null); }}
            aria-label="Tempo estimado de entrega em minutos"
            style={{
              width: 110, padding: '10px 12px', borderRadius: 10, fontSize: 15, fontWeight: 700,
              border: (valor === '' || valido) ? '1.5px solid var(--gray-200)' : '1.5px solid #DC2626',
              fontFamily: 'var(--font-body)', color: 'var(--gray-900)', background: 'var(--white)',
            }} />
          <span style={{ fontSize: 14, color: 'var(--gray-500)', fontWeight: 600 }}>minutos</span>
          <button onClick={() => salvar()} disabled={!mudou || salvando}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none',
              cursor: (!mudou || salvando) ? 'default' : 'pointer',
              background: (!mudou || salvando) ? 'var(--gray-200)' : 'var(--grape)',
              color: (!mudou || salvando) ? 'var(--gray-500)' : '#fff',
              fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-body)', transition: 'all .2s',
            }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>

        {!valido && valor !== '' && (
          <p style={{ fontSize: 12.5, color: '#DC2626', marginTop: 10, fontWeight: 600 }}>
            Valor inválido. Use um número inteiro entre {ETA_MIN} e {ETA_MAX}.
          </p>
        )}
        {msg && (
          <p style={{ fontSize: 13, marginTop: 12, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>
            {msg.texto}
          </p>
        )}

        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 16, lineHeight: 1.5 }}>
          A loja e a tela de confirmação usam exatamente este mesmo valor (fonte única).
        </p>
      </div>
    </div>
  );
}
