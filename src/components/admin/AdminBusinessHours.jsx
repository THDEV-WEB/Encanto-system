/* components/admin/AdminBusinessHours.jsx — REF-BUSINESS-HOURS-04.
   Controle administrativo do CRONOGRAMA SEMANAL de funcionamento (quais dias abrem, em quais horarios,
   quantos periodos por dia). FONTE UNICA no Supabase (settings via RPC set_business_hours_schedule).
   Consome o MESMO cronograma que a loja usa para decidir aberto/fechado (useBusinessHoursSchedule).

   Fluxo CLARO: toda edicao (switch aberto/fechado, horarios, adicionar/remover periodo, copiar horarios)
   fica PENDENTE na tela; o botao "Salvar Alterações" (unico, no rodape) e a UNICA acao que grava — sem
   auto-save, mesmo padrao de AdminDeliveryEta/AdminEmpresa. Valida no cliente (feedback imediato por
   periodo: horario invalido, fim<=inicio, sobreposto, duplicado) — o servidor SEMPRE revalida tudo de novo
   (is_admin + as mesmas regras), entao nenhuma escrita mal-formada persiste mesmo se o cliente falhar em
   bloquear. O override (AUTO/OPEN/CLOSED, AdminStatus) e o cronograma (aqui) sao PAINEIS SEPARADOS que
   se combinam so no engine (resolverOverride) — este componente nunca decide "aberto agora", so edita a
   grade semanal. */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useBusinessHoursSchedule } from '../../hooks/useBusinessHoursSchedule.js';
import { useStoreConfigStatus } from '../../hooks/useStoreConfigStatus.js';
import { definirCronograma, DIA_NOMES, DIAS_LONGOS } from '../../services/businessHours/index.js';
import { paraEditavel, paraPersistir, validarDia, aplicarCopiaHorarios } from '../../services/businessHours/scheduleForm.js';

/* REF-STORE-ONBOARD-01 · Onda 1: mesmo papel/estilo de StatusLocalizacaoLoja (AdminTaxaEntrega.jsx) --
   sem isso, uma loja nova nao tem como saber que o cronograma abaixo e' o horario REAL de outro negocio
   (fallback hardcoded de get_business_hours_schedule), nao um exemplo neutro. tem_horario_config === null
   (RPC ainda nao respondeu, ou falhou) nao renderiza nada -- nunca bloqueia a edicao normal. */
function StatusHorarioLoja({ configurado }) {
  if (configurado === null) return null;
  const cor = configurado ? '#16A34A' : '#DC2626';
  const fundo = configurado ? '#F0FDF4' : '#FEF2F2';
  return (
    <div role="status" data-testid="status-horario-loja" data-configurada={configurado} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 12,
      background: fundo, border: `1.5px solid ${cor}`, marginBottom: 18,
    }}>
      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>{configurado ? '✅' : '❌'}</span>
      <div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: cor }}>
          {configurado ? 'Horário configurado para esta loja' : 'Horário ainda NÃO configurado para esta loja'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--gray-700)', marginTop: 3, lineHeight: 1.6 }}>
          {configurado
            ? 'A grade abaixo é o horário real desta loja.'
            : 'A grade abaixo é um exemplo temporário, não o horário real do seu negócio. Ajuste os dias/horários e clique em "Salvar Alterações" para substituir o padrão.'}
        </div>
      </div>
    </div>
  );
}

function Switch({ ativo, onChange, disabled }) {
  return (
    <button type="button" onClick={onChange} disabled={disabled} aria-pressed={ativo}
      aria-label={ativo ? 'Marcar como fechado' : 'Marcar como aberto'}
      style={{
        width: 42, height: 24, borderRadius: 999, border: 'none', padding: 2, flexShrink: 0,
        cursor: disabled ? 'default' : 'pointer', background: ativo ? '#16A34A' : 'var(--gray-300)',
        transition: 'background .18s', position: 'relative',
      }}>
      <span style={{
        display: 'block', width: 20, height: 20, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'transform .18s',
        transform: ativo ? 'translateX(18px)' : 'translateX(0)',
      }} />
    </button>
  );
}

function DiaCard({ nome, rotulo, dia, erros, onToggle, onPeriodoChange, onAdicionar, onRemover, onAbrirCopiar }) {
  const fechado = dia.fechado;
  return (
    <div style={{ border: '1.5px solid var(--gray-200)', borderRadius: 14, padding: '16px 18px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: fechado ? '#DC2626' : '#16A34A' }} />
          <strong style={{ fontSize: 15, color: 'var(--gray-800)' }}>{rotulo}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <button type="button" onClick={onAbrirCopiar}
            style={{ border: 'none', background: 'transparent', color: 'var(--grape)', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', padding: '4px 2px' }}>
            📋 Copiar para...
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: fechado ? 'var(--gray-500)' : '#16A34A', minWidth: 50 }}>
              {fechado ? 'Fechado' : 'Aberto'}
            </span>
            <Switch ativo={!fechado} onChange={onToggle} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, opacity: fechado ? 0.45 : 1, pointerEvents: fechado ? 'none' : 'auto' }}>
        {!fechado && dia.periodos.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--gray-400)', marginBottom: 8 }}>
            Nenhum período configurado — a loja ficará fechada neste dia até adicionar um horário.
          </p>
        )}
        {dia.periodos.map((p, i) => {
          const erro = erros.get(p._id);
          const borda = erro ? '1.5px solid #DC2626' : '1.5px solid var(--gray-200)';
          return (
            <div key={p._id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--gray-500)', minWidth: 62 }}>Período {i + 1}</span>
              <input type="time" value={p.ini} disabled={fechado} aria-label={`Início do período ${i + 1} — ${rotulo}`}
                onChange={(e) => onPeriodoChange(p._id, 'ini', e.target.value)}
                style={{ padding: '7px 9px', borderRadius: 8, border: borda, fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--gray-900)' }} />
              <span style={{ color: 'var(--gray-400)', fontSize: 13 }}>até</span>
              <input type="time" value={p.fim} disabled={fechado} aria-label={`Fim do período ${i + 1} — ${rotulo}`}
                onChange={(e) => onPeriodoChange(p._id, 'fim', e.target.value)}
                style={{ padding: '7px 9px', borderRadius: 8, border: borda, fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--gray-900)' }} />
              <button type="button" onClick={() => onRemover(p._id)} disabled={fechado} aria-label={`Remover período ${i + 1}`}
                style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: fechado ? 'default' : 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1 }}>
                ✕
              </button>
              {erro && <span style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 600 }}>{erro}</span>}
            </div>
          );
        })}
        <button type="button" onClick={onAdicionar} disabled={fechado}
          style={{
            border: '1.5px dashed var(--gray-300)', background: 'transparent', color: 'var(--grape)',
            borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700,
            cursor: fechado ? 'default' : 'pointer', fontFamily: 'var(--font-body)',
          }}>
          + Adicionar período
        </button>
      </div>
    </div>
  );
}

/* Modal "Copiar horários para..." — replica o dia de ORIGEM (fechado + periodos, tudo pendente, ainda nao
   salvo) para os dias marcados. Overlay/card no mesmo estilo dos demais modais do Admin (ComandaModal). */
function CopiarModal({ origem, rotuloOrigem, alvo, setAlvo, onAplicar, onFechar }) {
  const outrosDias = DIA_NOMES.filter((d) => d !== origem);
  const alternar = (d) => setAlvo((prev) => { const next = new Set(prev); next.has(d) ? next.delete(d) : next.add(d); return next; });
  return (
    <div role="dialog" aria-modal="true" aria-label={`Copiar horários de ${rotuloOrigem}`} onClick={onFechar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,14,10,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--white)', borderRadius: 16, width: 'min(360px, 96vw)', boxShadow: '0 18px 50px rgba(0,0,0,.3)', padding: 20 }}>
        <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--gray-800)', marginBottom: 4 }}>📋 Copiar horários de {rotuloOrigem}</h4>
        <p style={{ fontSize: 12.5, color: 'var(--gray-500)', marginBottom: 14 }}>Escolha para quais dias replicar o horário (substitui o que já estiver configurado neles).</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          {outrosDias.map((d) => (
            <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: 'var(--gray-700)', cursor: 'pointer' }}>
              <input type="checkbox" checked={alvo.has(d)} onChange={() => alternar(d)} style={{ width: 16, height: 16 }} />
              {DIAS_LONGOS[DIA_NOMES.indexOf(d)]}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onFechar}
            style={{ border: '1.5px solid var(--gray-200)', background: 'var(--white)', color: 'var(--gray-600)', borderRadius: 10, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)' }}>
            Cancelar
          </button>
          <button type="button" onClick={onAplicar} disabled={alvo.size === 0}
            style={{
              border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13.5, fontWeight: 700, fontFamily: 'var(--font-body)',
              cursor: alvo.size === 0 ? 'default' : 'pointer',
              background: alvo.size === 0 ? 'var(--gray-200)' : 'var(--grape)', color: alvo.size === 0 ? 'var(--gray-500)' : '#fff',
            }}>
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminBusinessHours() {
  const cronograma = useBusinessHoursSchedule();      // documento OFICIAL (fonte unica)
  const configStatus = useStoreConfigStatus();        // REF-STORE-ONBOARD-01 · Onda 1: propria ou padrao?
  const idRef = useRef(0);
  const nextId = () => (idRef.current += 1);

  const [dias, setDias] = useState(() => paraEditavel(cronograma.schedule, nextId));
  const [copiar, setCopiar] = useState(null);          // { origem: 'terca' } | null
  const [copiarAlvo, setCopiarAlvo] = useState(new Set());
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);                // { tipo:'ok'|'erro', texto }

  // quando o cronograma OFICIAL muda de conteúdo (mount/sync/outro save), os campos refletem o novo oficial
  // — comparado por CONTEÚDO (não por referência), para não descartar edições em andamento a cada poll.
  const scheduleKey = JSON.stringify(cronograma.schedule);
  useEffect(() => { setDias(paraEditavel(cronograma.schedule, nextId)); setMsg(null); }, [scheduleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const errosPorDia = useMemo(() => {
    const m = {};
    for (const nome of DIA_NOMES) m[nome] = validarDia(dias[nome].periodos);
    return m;
  }, [dias]);
  const temErro = DIA_NOMES.some((d) => errosPorDia[d].size > 0);
  const mudou = useMemo(() => JSON.stringify(paraPersistir(dias)) !== scheduleKey, [dias, scheduleKey]);

  const alternarFechado = (dia) => { setDias((prev) => ({ ...prev, [dia]: { ...prev[dia], fechado: !prev[dia].fechado } })); setMsg(null); };
  const atualizarPeriodo = (dia, id, campo, valor) => {
    setDias((prev) => ({ ...prev, [dia]: { ...prev[dia], periodos: prev[dia].periodos.map((p) => (p._id === id ? { ...p, [campo]: valor } : p)) } }));
    setMsg(null);
  };
  const adicionarPeriodo = (dia) => {
    setDias((prev) => ({ ...prev, [dia]: { ...prev[dia], periodos: [...prev[dia].periodos, { _id: nextId(), ini: '10:00', fim: '15:00' }] } }));
    setMsg(null);
  };
  const removerPeriodo = (dia, id) => {
    setDias((prev) => ({ ...prev, [dia]: { ...prev[dia], periodos: prev[dia].periodos.filter((p) => p._id !== id) } }));
    setMsg(null);
  };

  const abrirCopiar = (origem) => { setCopiar({ origem }); setCopiarAlvo(new Set()); };
  const aplicarCopia = () => {
    setDias((prev) => aplicarCopiaHorarios(prev, copiar.origem, copiarAlvo, nextId));
    setCopiar(null);
    setMsg(null);
  };

  const salvar = async () => {
    if (!mudou || temErro || salvando) return;
    setSalvando(true); setMsg(null);
    const r = await definirCronograma({ schedule: paraPersistir(dias), exceptions: cronograma.exceptions || {} });
    setSalvando(false);
    if (r.ok) { setMsg({ tipo: 'ok', texto: 'Horário de funcionamento salvo com sucesso.' }); configStatus.refresh(); }
    else setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar. Verifique seu acesso de administrador.' });
  };

  return (
    <div className="admin-card" style={{ marginBottom: 20 }}>
      <div className="admin-card-header"><h3>🕒 Horário de Funcionamento</h3></div>
      <div style={{ padding: '24px 20px' }}>
        <StatusHorarioLoja configurado={configStatus.tem_horario_config} />
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 18 }}>
          Configure os dias e horários em que a loja atende. Cada dia aceita quantos períodos forem necessários
          (ex.: manhã e noite). O botão <strong>Salvar Alterações</strong> aplica tudo de uma vez.
        </p>

        {DIA_NOMES.map((nome, i) => (
          <DiaCard
            key={nome} nome={nome} rotulo={DIAS_LONGOS[i]} dia={dias[nome]} erros={errosPorDia[nome]}
            onToggle={() => alternarFechado(nome)}
            onPeriodoChange={(id, campo, valor) => atualizarPeriodo(nome, id, campo, valor)}
            onAdicionar={() => adicionarPeriodo(nome)}
            onRemover={(id) => removerPeriodo(nome, id)}
            onAbrirCopiar={() => abrirCopiar(nome)}
          />
        ))}

        {temErro && (
          <p style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600, marginBottom: 10 }}>
            Corrija os períodos destacados em vermelho antes de salvar.
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
          <button type="button" onClick={salvar} disabled={!mudou || temErro || salvando}
            style={{
              padding: '11px 20px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-body)',
              cursor: (!mudou || temErro || salvando) ? 'default' : 'pointer',
              background: (!mudou || temErro || salvando) ? 'var(--gray-200)' : 'var(--grape)',
              color: (!mudou || temErro || salvando) ? 'var(--gray-500)' : '#fff',
            }}>
            💾 {salvando ? 'Salvando…' : 'Salvar Alterações'}
          </button>
          {!mudou && !msg && <span style={{ fontSize: 12.5, color: 'var(--gray-400)' }}>Nenhuma alteração pendente.</span>}
          {msg && (
            <span style={{ fontSize: 13, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</span>
          )}
        </div>

        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 16, lineHeight: 1.5 }}>
          A loja, o cardápio e o checkout usam exatamente este cronograma. O modo Automático/Forçar (acima) continua funcionando normalmente sobre este horário.
        </p>
      </div>

      {copiar && (
        <CopiarModal
          origem={copiar.origem} rotuloOrigem={DIAS_LONGOS[DIA_NOMES.indexOf(copiar.origem)]}
          alvo={copiarAlvo} setAlvo={setCopiarAlvo} onAplicar={aplicarCopia} onFechar={() => setCopiar(null)}
        />
      )}
    </div>
  );
}
