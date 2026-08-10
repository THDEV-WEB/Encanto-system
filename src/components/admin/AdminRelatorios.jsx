/* components/admin/AdminRelatorios.jsx — REF-DASHBOARD-01.
   BI de negócio por período (admin_reports_summary): faturamento/dia, top produtos, forma de
   pagamento, entrega vs retirada. Diferente do Dashboard (snapshot de hoje) e da Saúde
   (observabilidade técnica) — aqui o admin escolhe o RECORTE de tempo pra analisar. Pedidos
   cancelados são excluídos no servidor (decisão de escopo desta ref).
   Gráfico de barras reaproveita o MESMO estilo inline já usado em AdminHealth.jsx (serie_7d) —
   nenhuma lib de gráfico nova. */
import { useState, useEffect, useCallback } from 'react';
import { DS } from '../../services/DataService.js';
import { fmt } from '../../utils/format.js';
import { Spinner } from '../ui/Spinner.jsx';

const hojeISO = () => new Date().toISOString().slice(0, 10);
const diasAtras = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const PRESETS = [
  { id: '7d', label: '7 dias', dias: 7 },
  { id: '30d', label: '30 dias', dias: 30 },
  { id: '90d', label: '90 dias', dias: 90 },
];

/* Mesmos rótulos/ícones de CheckoutPage.jsx (`pays`) — mantidos aqui só como apresentação (nenhuma
   regra de negócio depende deles); se um novo método de pagamento nascer no checkout, aparece com o
   valor cru até alguém adicionar o rótulo aqui também. */
const LABEL_PAGAMENTO = {
  dinheiro: '💵 Dinheiro', pix: '📲 PIX', cartao_debito: '💳 Débito', cartao_credito: '💳 Crédito',
};

export function AdminRelatorios() {
  const [preset, setPreset] = useState('30d');
  const [inicio, setInicio] = useState(diasAtras(30));
  const [fim, setFim] = useState(hojeISO());
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async (i, f) => {
    setLoading(true); setErro(null);
    const r = await DS.getRelatorios(i, f);
    if (!r) setErro('Não foi possível carregar os relatórios.');
    setDados(r);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(inicio, fim); }, [carregar, inicio, fim]);

  const aplicarPreset = (p) => {
    setPreset(p.id);
    setInicio(diasAtras(p.dias));
    setFim(hojeISO());
  };

  const serie = dados?.serie_dia || [];
  const maxFat = Math.max(1, ...serie.map((d) => Number(d.faturamento) || 0));

  return (
    <div>
      <div className="admin-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => aplicarPreset(p)}
              className={preset === p.id ? 'btn-primary' : 'btn-secondary'}>
              {p.label}
            </button>
          ))}
          <span style={{ fontSize: 12.5, color: 'var(--gray-500)', marginLeft: 4 }}>ou período personalizado:</span>
          <input type="date" value={inicio} max={fim}
            onChange={(e) => { setPreset(null); setInicio(e.target.value); }}
            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--gray-300)' }} />
          <span style={{ color: 'var(--gray-400)' }}>até</span>
          <input type="date" value={fim} min={inicio} max={hojeISO()}
            onChange={(e) => { setPreset(null); setFim(e.target.value); }}
            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--gray-300)' }} />
        </div>
      </div>

      {loading ? <Spinner /> : erro ? (
        <div className="empty-state"><div className="icon">📈</div><p>{erro}</p></div>
      ) : !dados || dados.total_pedidos === 0 ? (
        <div className="empty-state"><div className="icon">📈</div><p>Nenhum pedido no período selecionado.</p></div>
      ) : (
        <>
          <div className="stat-cards" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 20 }}>
            <div className="stat-card" style={{ borderTop: '3px solid var(--grape)' }}>
              <div className="stat-icon">📦</div>
              <div className="stat-val">{dados.total_pedidos}</div>
              <div className="stat-label">Pedidos no período</div>
            </div>
            <div className="stat-card" style={{ borderTop: '3px solid #16A34A' }}>
              <div className="stat-icon">💰</div>
              <div className="stat-val">{fmt(dados.total_receita)}</div>
              <div className="stat-label">Receita no período</div>
            </div>
            <div className="stat-card" style={{ borderTop: '3px solid #0891B2' }}>
              <div className="stat-icon">📊</div>
              <div className="stat-val">{fmt(dados.total_pedidos > 0 ? dados.total_receita / dados.total_pedidos : 0)}</div>
              <div className="stat-label">Ticket médio</div>
            </div>
          </div>

          <div className="admin-card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 12 }}>💰 Faturamento por dia</h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: Math.max(1, 4 - Math.floor(serie.length / 20)), height: 110, overflowX: 'auto' }}>
              {serie.map((d, i) => (
                <div key={i} style={{ flex: '1 0 auto', minWidth: 6, textAlign: 'center' }} title={`${d.dia}: ${fmt(d.faturamento)} (${d.pedidos} pedidos)`}>
                  <div style={{ height: `${(Number(d.faturamento) / maxFat) * 80}px`, minHeight: Number(d.faturamento) > 0 ? 2 : 0, background: 'var(--grape)', borderRadius: 3 }} />
                  {serie.length <= 31 && <div style={{ fontSize: 9, color: 'var(--gray-500)', marginTop: 4 }}>{d.dia}</div>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
            <div className="admin-card">
              <h3 style={{ marginBottom: 12 }}>🏆 Produtos mais vendidos</h3>
              {dados.top_produtos.length === 0 ? <p style={{ color: 'var(--gray-500)', fontSize: 13 }}>Sem dados.</p> : (
                <table className="data-table">
                  <thead><tr><th>Produto</th><th>Qtd</th><th>Receita</th></tr></thead>
                  <tbody>{dados.top_produtos.map((p, i) => (
                    <tr key={i}><td>{p.nome}</td><td>{p.quantidade}</td><td style={{ fontWeight: 700 }}>{fmt(p.receita)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>

            <div className="admin-card">
              <h3 style={{ marginBottom: 12 }}>💳 Forma de pagamento</h3>
              {dados.por_pagamento.map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < dados.por_pagamento.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                  <span>{LABEL_PAGAMENTO[p.forma] || p.forma}</span>
                  <span><b>{fmt(p.receita)}</b> <span style={{ color: 'var(--gray-500)', fontSize: 12 }}>({p.pedidos})</span></span>
                </div>
              ))}
            </div>

            <div className="admin-card">
              <h3 style={{ marginBottom: 12 }}>🚚 Entrega vs. retirada</h3>
              {dados.por_tipo.map((t, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < dados.por_tipo.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                  <span>{t.tipo === 'retirada' ? '🏪 Retirada' : '🚚 Entrega'}</span>
                  <span><b>{fmt(t.receita)}</b> <span style={{ color: 'var(--gray-500)', fontSize: 12 }}>({t.pedidos})</span></span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
