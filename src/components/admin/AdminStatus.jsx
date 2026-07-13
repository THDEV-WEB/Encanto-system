/* components/admin/AdminStatus.jsx — REF-BUSINESS-HOURS-02.
   Painel de status da loja. NAO calcula aberto/fechado por conta propria: consome o MESMO estado final
   que a loja (useBusinessHours -> resolverOverride, fonte unica). Aqui o Admin apenas escolhe o MODO
   (AUTO/OPEN/CLOSED) via definirModo — sobrescreve TEMPORARIAMENTE o resultado; o cronograma fica intacto.
   Prioridade da decisao (OPEN>CLOSED>AUTO) vive so no servico; este componente nunca a repete. */
import { useState } from 'react';
import { useBusinessHours } from '../../hooks/useBusinessHours.js';
import { definirModo, MODOS } from '../../services/businessHours/index.js';

const OPCOES = [
  { modo: MODOS.AUTO,   titulo: 'Automático',    desc: 'Segue o horário oficial da loja',        cor: '#6B21A8', bg: '#F5F3FF', bd: '#DDD6FE' },
  { modo: MODOS.OPEN,   titulo: 'Forçar Aberta', desc: 'Aberta mesmo fora do horário',           cor: '#16A34A', bg: '#F0FDF4', bd: '#BBF7D0' },
  { modo: MODOS.CLOSED, titulo: 'Forçar Fechada',desc: 'Fechada mesmo dentro do horário',        cor: '#DC2626', bg: '#FEF2F2', bd: '#FECACA' },
];

export function AdminStatus() {
  const h = useBusinessHours();
  const [salvando, setSalvando] = useState(null);   // modo em gravacao (ou null)
  const [erro, setErro] = useState('');

  /* Grava o modo na FONTE OFICIAL (Supabase, via definirModo -> set_store_mode). Otimista: a UI ja
     reflete pelo evento; aqui so tratamos o estado de salvando/erro do servidor. */
  const escolher = async (m) => {
    if (salvando || m === h.modo) return;
    setSalvando(m); setErro('');
    const r = await definirModo(m);
    setSalvando(null);
    if (!r.ok) setErro(r.error === 'offline' ? 'Sem conexão — tente novamente.' : 'Não foi possível salvar. Verifique seu acesso de administrador.');
  };

  const aberta = h.aberto;
  const forcada = h.forcado;
  const cor = aberta ? '#16A34A' : '#DC2626';
  const bgStatus = aberta ? '#F0FDF4' : '#FEF2F2';
  const bdStatus = aberta ? '#BBF7D0' : '#FECACA';
  const origem = forcada ? 'Forçada pelo administrador' : 'Automático';

  return (
    <div>
      <div className="admin-card" style={{ marginBottom: 20 }}>
        <div className="admin-card-header">
          <h3>🏪 Status da Loja</h3>
        </div>
        <div style={{ padding: '24px 20px' }}>

          {/* ── STATUS ATUAL (resolvido — mesma fonte da loja) ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '16px 18px', borderRadius: 14, marginBottom: 22,
            background: bgStatus, border: `1.5px solid ${bdStatus}`,
          }}>
            <span style={{
              width: 14, height: 14, borderRadius: '50%', flexShrink: 0, background: cor,
              boxShadow: `0 0 0 3px ${cor}33`,
            }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--gray-500)' }}>Status atual</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: cor, lineHeight: 1.2 }}>
                {aberta ? '🟢 Aberta' : '🔴 Fechada'}{' '}
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-500)' }}>({origem})</span>
              </div>
              {/* Detalhe do cronograma (mesmas strings da loja): "Aberto até 15:00", "Abre amanhã às 10:00"... */}
              {h.detalhe && (
                <div style={{ fontSize: 12.5, color: 'var(--gray-500)', marginTop: 3 }}>{h.detalhe}</div>
              )}
            </div>
          </div>

          <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 14 }}>
            Escolha o modo de operação. Em <strong>Automático</strong>, a loja abre e fecha sozinha pelo horário
            oficial. Os modos <strong>Forçar</strong> sobrescrevem temporariamente esse resultado sem alterar o horário.
          </p>

          {/* ── MODOS (AUTO / OPEN / CLOSED) ── */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {OPCOES.map((o) => {
              const ativo = h.modo === o.modo;
              const gravando = salvando === o.modo;
              return (
                <button
                  key={o.modo}
                  onClick={() => escolher(o.modo)}
                  disabled={!!salvando}
                  style={{
                    flex: 1, minWidth: 150, padding: '16px 18px', borderRadius: 14,
                    cursor: salvando ? 'default' : 'pointer', opacity: salvando && !gravando ? 0.6 : 1,
                    border: ativo ? `2.5px solid ${o.cor}` : '2px solid var(--gray-200)',
                    background: ativo ? o.bg : 'var(--white)',
                    display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                    transition: 'all .2s', fontFamily: 'var(--font-body)',
                  }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    border: ativo ? `5px solid ${o.cor}` : '2px solid var(--gray-300)',
                    background: 'var(--white)', boxSizing: 'border-box',
                  }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: ativo ? o.cor : 'var(--gray-700)' }}>{o.titulo}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>{gravando ? 'Salvando…' : o.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {erro && <p style={{ fontSize: 13, color: '#DC2626', marginTop: 12, fontWeight: 600 }}>{erro}</p>}

          <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 16, lineHeight: 1.5 }}>
            {h.modo === MODOS.AUTO
              ? 'Modo automático ativo — o status acima segue o horário de funcionamento.'
              : 'Override manual ativo — clique em “Automático” para voltar ao horário oficial.'}
            {' '}A loja, o cardápio e o checkout usam exatamente este mesmo status.
          </p>

        </div>
      </div>
    </div>
  );
}
