/* components/admin/AdminTaxaEntrega.jsx — REF-DELIVERY-FEE-01.
   Controle administrativo da taxa de entrega automática por distância: localização da loja (pino no
   mapa — usada para calcular a distância até o cliente), toggle "Ativar cobrança automática", tabela de
   faixas De/Até/Valor (editável: +Adicionar/✕Remover, validação inline de sobreposição/duplicata/
   negativo/intervalo inválido — o servidor SEMPRE revalida tudo de novo) e o acréscimo de retorno da
   maquininha (débito/crédito). FONTE ÚNICA no Supabase: localização vive em company_info (mesma RPC de
   sempre, set_company_info); ativo/faixas/maquininha vivem juntos numa chave própria
   (delivery_fee_config) — mesmo padrão de "documento inteiro, um Salvar" de AdminBusinessHours.

   2 blocos, 2 fontes, 2 botões "Salvar" independentes — honesto com a arquitetura (são 2 RPCs
   diferentes); nenhum otimismo pré-escrita, mesmo padrão TRUTHFUL de AdminEmpresa/AdminBusinessHours/
   AdminDeliveryEta (só reflete "salvo" quando o servidor confirma). */
import { useState, useEffect, useRef, useMemo } from 'react';
import { useDeliveryFeeConfig } from '../../hooks/useDeliveryFeeConfig.js';
import { useCompanyInfo } from '../../hooks/useCompanyInfo.js';
import { definirDeliveryFeeConfig } from '../../services/delivery/deliveryFeeConfig.js';
import { salvarCompanyInfo } from '../../services/company/companyInfo.js';
import { localizacaoLojaConfigurada } from '../../services/company/companyInfoRules.js';
import { paraEditavel, paraPersistirFaixas, validarFaixas, valorMaquininhaValido } from '../../services/delivery/deliveryFeeConfigForm.js';
import { carregarLeaflet, criarMapa, destruirMapa, formatarCoord, CENTRO_PADRAO } from '../../address/index.js';

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

function ToggleRow({ titulo, descricao, ativo, onChange, disabled }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
      padding: '12px 16px', background: 'var(--gray-50)', borderRadius: 10,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray-700)' }}>{titulo}</div>
        {descricao && <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>{descricao}</div>}
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={ativo} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

/* REF-DELIVERY-FEE-02: banner de status — bloqueante operacional real da REF-DELIVERY-FEE-01 (auditoria
   pós-implantação): sem lojaLat/lojaLng, TODO pedido de entrega cai no fallback "sem_coordenadas" e sai
   com taxa R$ 0,00, mas nada na tela avisava isso de forma destacada (só uma legenda cinza pequena perto
   do mapa). Aparece assim que o Admin abre a aba (mesmo antes de qualquer interação) — é o "diagnóstico
   no carregamento" + o "indicador de saúde" ✅/❌ pedidos na auditoria, numa peça só: 2 indicadores
   fisicamente separados do MESMO estado poderiam divergir (foi exatamente o bug que motivou
   localizacaoLojaConfigurada existir). Não é uma tabela/serviço novo — deriva 100% de useCompanyInfo(),
   já carregado por esta tela. */
function StatusLocalizacaoLoja({ configurada }) {
  const cor = configurada ? '#16A34A' : '#DC2626';
  const fundo = configurada ? '#F0FDF4' : '#FEF2F2';
  return (
    <div role="status" data-testid="status-localizacao-loja" data-configurada={configurada} style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 12,
      background: fundo, border: `1.5px solid ${cor}`, marginBottom: 20,
    }}>
      <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>{configurada ? '✅' : '❌'}</span>
      <div>
        <div data-testid="status-localizacao-titulo" style={{ fontSize: 13.5, fontWeight: 700, color: cor }}>
          {configurada ? 'Localização da loja configurada' : 'Localização da loja NÃO configurada'}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--gray-700)', marginTop: 3, lineHeight: 1.6 }}>
          {configurada
            ? 'O cálculo de distância está ativo — cada pedido de entrega recebe a taxa da faixa correspondente.'
            : 'Sem essa configuração, TODOS os pedidos de entrega saem com taxa R$ 0,00 (o checkout nunca é '
              + 'bloqueado, mas a cobrança real não acontece). Arraste o pino até a loja no mapa abaixo e clique '
              + 'em "Salvar localização".'}
        </div>
      </div>
    </div>
  );
}

/* Mapa com 1 pino arrastável — reaproveita a MESMA infraestrutura Leaflet/OSM (gratuita) do domínio
   Address (mapService.js), sem serviço novo. `key` do chamador (coordKey) força remontar nesta posição
   sempre que o valor OFICIAL mudar (1º carregamento, após salvar, ou outra sessão salvando por cima). */
function MapaLocalizacaoLoja({ lat, lng, onMudar }) {
  const mapRef = useRef(null);
  const leafRef = useRef(null);
  const [pos, setPos] = useState({ lat, lng });

  useEffect(() => {
    let cancelado = false;
    const mover = (la, ln) => { setPos({ lat: la, lng: ln }); onMudar(la, ln); };
    const init = () => {
      if (cancelado || !window.L || !mapRef.current || leafRef.current) return;
      leafRef.current = criarMapa(mapRef.current, { lat, lng, zoom: 15, aoArrastar: mover, aoClicar: mover });
    };
    carregarLeaflet(init);
    return () => { cancelado = true; destruirMapa(leafRef.current); leafRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 1 instância por key (o pai remonta ao trocar lat/lng oficiais)
  }, []);

  return (
    <>
      <div className="addr-map-container" style={{ height: 280 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>
      <p style={{ fontSize: 10, color: 'var(--gray-400)', textAlign: 'center', marginTop: 6 }}>
        Lat: {formatarCoord(pos.lat)} · Lng: {formatarCoord(pos.lng)}
      </p>
    </>
  );
}

function BlocoLocalizacao() {
  const info = useCompanyInfo();
  const configurada = localizacaoLojaConfigurada(info);
  const coordKey = `${info.lojaLat ?? ''}|${info.lojaLng ?? ''}`;
  const latOficial = configurada ? info.lojaLat : CENTRO_PADRAO.lat;
  const lngOficial = configurada ? info.lojaLng : CENTRO_PADRAO.lng;
  const [novaPin, setNovaPin] = useState(null);   // null = nada pendente nesta sessão
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);
  // REF-DELIVERY-FEE-02: bump força o mapa a REMONTAR na posição OFICIAL (mesmo mecanismo do `key` de
  // coordKey abaixo) mesmo quando ela não mudou — é assim que "Centralizar" descarta um arrasto
  // pendente sem precisar de acesso imperativo ao marker do Leaflet (que mapService.js não expõe).
  const [resetTick, setResetTick] = useState(0);

  // Só reseta o pino pendente (não a mensagem) — salvarCompanyInfo já notifica useCompanyInfo() ANTES
  // de retornar, então este efeito dispara no mesmo ciclo em que `salvar()` acabou de chamar setMsg
  // com sucesso; limpar `msg` aqui apagava a confirmação antes de qualquer render pintá-la (achado real
  // na validação da REF-SAAS-01 · Onda 7.1, 1ª vez que este round-trip roda de ponta a ponta no E2E).
  useEffect(() => { setNovaPin(null); }, [coordKey]);

  const salvar = async () => {
    if (!novaPin || salvando) return;
    setSalvando(true); setMsg(null);
    const r = await salvarCompanyInfo({ lojaLat: novaPin.lat, lojaLng: novaPin.lng });
    setSalvando(false);
    if (r.ok) setMsg({ tipo: 'ok', texto: 'Localização da loja salva com sucesso.' });
    else setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar.' });
  };

  const centralizar = () => { setNovaPin(null); setMsg(null); setResetTick((t) => t + 1); };

  return (
    <Bloco icone="📍" titulo="Localização da loja"
      descricao="Arraste (ou clique n) o pino até o endereço da loja. Essa coordenada é usada para calcular a distância até o cliente e definir a taxa de entrega automaticamente — sem ela, nenhum pedido tem taxa calculada.">
      <MapaLocalizacaoLoja key={`${coordKey}-${resetTick}`} lat={latOficial} lng={lngOficial} onMudar={(lat, lng) => { setNovaPin({ lat, lng }); setMsg(null); }} />
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={salvar} disabled={!novaPin || salvando}
          style={{
            padding: '10px 18px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 13.5, fontFamily: 'var(--font-body)',
            cursor: (!novaPin || salvando) ? 'default' : 'pointer',
            background: (!novaPin || salvando) ? 'var(--gray-200)' : 'var(--grape)',
            color: (!novaPin || salvando) ? 'var(--gray-500)' : '#fff',
          }}>
          💾 {salvando ? 'Salvando…' : 'Salvar localização'}
        </button>
        <button type="button" onClick={centralizar}
          title="Descarta qualquer arrasto não salvo e volta o mapa para a posição atualmente cadastrada"
          style={{
            padding: '9px 16px', borderRadius: 10, border: '1.5px solid var(--gray-300)', fontWeight: 600, fontSize: 13, fontFamily: 'var(--font-body)',
            cursor: 'pointer', background: 'transparent', color: 'var(--gray-700)',
          }}>
          🎯 Centralizar no ponto salvo
        </button>
        {!novaPin && !msg && (
          <span style={{ fontSize: 12.5, color: configurada ? 'var(--gray-400)' : '#DC2626', fontWeight: configurada ? 400 : 600 }}>
            {configurada ? '📍 Localização salva.' : '⚠️ Localização ainda não definida — arraste o pino até a loja.'}
          </span>
        )}
        {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</span>}
      </div>
      {!configurada && (
        <p style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 8 }}>
          Sem posição salva ainda: o mapa mostra um centro padrão genérico, não a loja de verdade.
        </p>
      )}
    </Bloco>
  );
}

function FaixaLinha({ faixa, indice, erro, onCampo, onRemover }) {
  const borda = erro ? '1.5px solid #DC2626' : '1.5px solid var(--gray-200)';
  const campoStyle = { padding: '7px 9px', borderRadius: 8, border: borda, fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--gray-900)' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--gray-500)', minWidth: 18 }}>{indice + 1}.</span>
      <label style={{ fontSize: 12, color: 'var(--gray-500)' }}>De</label>
      <input type="number" step="0.1" min="0" value={faixa.de} aria-label={`Faixa ${indice + 1} — de (km)`}
        onChange={(e) => onCampo(faixa._id, 'de', e.target.value)} style={{ ...campoStyle, width: 68 }} />
      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>km até</span>
      <input type="number" step="0.1" min="0" value={faixa.ate} aria-label={`Faixa ${indice + 1} — até (km)`}
        onChange={(e) => onCampo(faixa._id, 'ate', e.target.value)} style={{ ...campoStyle, width: 68 }} />
      <span style={{ fontSize: 12, color: 'var(--gray-500)' }}>km — R$</span>
      <input type="number" step="0.01" min="0" value={faixa.valor} aria-label={`Faixa ${indice + 1} — valor (R$)`}
        onChange={(e) => onCampo(faixa._id, 'valor', e.target.value)} style={{ ...campoStyle, width: 84 }} />
      <button type="button" onClick={() => onRemover(faixa._id)} aria-label={`Remover faixa ${indice + 1}`}
        style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1 }}>
        ✕
      </button>
      {erro && <span style={{ fontSize: 11.5, color: '#DC2626', fontWeight: 600 }}>{erro}</span>}
    </div>
  );
}

function BlocoFaixas() {
  const config = useDeliveryFeeConfig();
  const idRef = useRef(0);
  const nextId = () => (idRef.current += 1);

  const [ativo, setAtivo] = useState(config.ativo);
  const [faixas, setFaixas] = useState(() => paraEditavel(config.faixas, nextId));
  const [maqAtivo, setMaqAtivo] = useState(config.maquininha?.ativo ?? true);
  const [maqValor, setMaqValor] = useState(String(config.maquininha?.valor ?? ''));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  // quando a config OFICIAL muda de conteúdo (mount/sync/outro save), os campos refletem o novo oficial
  // — comparado por CONTEÚDO, para não descartar edição em andamento a cada poll de 60s.
  const configKey = JSON.stringify({ ativo: config.ativo, maquininha: config.maquininha, faixas: config.faixas });
  useEffect(() => {
    setAtivo(config.ativo);
    setFaixas(paraEditavel(config.faixas, nextId));
    setMaqAtivo(config.maquininha?.ativo ?? true);
    setMaqValor(String(config.maquininha?.valor ?? ''));
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  const erros = useMemo(() => validarFaixas(faixas), [faixas]);
  const temErro = erros.size > 0;
  const maqValorOk = valorMaquininhaValido(maqValor);
  const faixasOrdenadas = useMemo(
    () => faixas.slice().sort((a, b) => Number(a.de) - Number(b.de)),
    [faixas],
  );

  const persistido = useMemo(() => ({
    ativo,
    maquininha: { ativo: maqAtivo, valor: maqValorOk ? Number(maqValor) : (config.maquininha?.valor ?? 0) },
    faixas: paraPersistirFaixas(faixas),
  }), [ativo, maqAtivo, maqValor, maqValorOk, faixas, config.maquininha]);
  const mudou = configKey !== JSON.stringify({ ativo: persistido.ativo, maquininha: persistido.maquininha, faixas: persistido.faixas });

  const atualizarFaixa = (id, campo, valor) => { setFaixas((prev) => prev.map((f) => (f._id === id ? { ...f, [campo]: valor } : f))); setMsg(null); };
  const adicionarFaixa = () => {
    const ultima = faixasOrdenadas[faixasOrdenadas.length - 1];
    const de = ultima && Number.isFinite(Number(ultima.ate)) ? (Math.round((Number(ultima.ate) + 0.1) * 10) / 10).toString() : '0';
    setFaixas((prev) => [...prev, { _id: nextId(), de, ate: '', valor: '' }]);
    setMsg(null);
  };
  const removerFaixa = (id) => { setFaixas((prev) => prev.filter((f) => f._id !== id)); setMsg(null); };

  const semFaixas = faixasOrdenadas.length === 0;

  const salvar = async () => {
    if (!mudou || temErro || !maqValorOk || semFaixas || salvando) return;
    setSalvando(true); setMsg(null);
    const r = await definirDeliveryFeeConfig(persistido);
    setSalvando(false);
    if (r.ok) setMsg({ tipo: 'ok', texto: 'Configuração de entrega salva com sucesso.' });
    else setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar. Verifique seu acesso de administrador.' });
  };

  const podeSalvar = mudou && !temErro && maqValorOk && !semFaixas && !salvando;

  return (
    <>
      <Bloco icone="🚚" titulo="Cobrança automática por distância"
        descricao="Quando ativa, todo pedido de entrega é cobrado pela faixa correspondente à distância até o cliente. Desativada, nenhuma taxa é cobrada (comportamento de antes desta configuração).">
        <ToggleRow titulo="Ativar cobrança automática" ativo={ativo} onChange={(v) => { setAtivo(v); setMsg(null); }} />
        <div style={{ marginTop: 16, opacity: ativo ? 1 : 0.5, pointerEvents: ativo ? 'auto' : 'none' }}>
          {faixasOrdenadas.length === 0 && (
            <p style={{ fontSize: 12.5, color: 'var(--gray-400)', marginBottom: 8 }}>Nenhuma faixa cadastrada — adicione ao menos uma.</p>
          )}
          {faixasOrdenadas.map((f, i) => (
            <FaixaLinha key={f._id} faixa={f} indice={i} erro={erros.get(f._id)} onCampo={atualizarFaixa} onRemover={removerFaixa} />
          ))}
          <button type="button" onClick={adicionarFaixa}
            style={{
              border: '1.5px dashed var(--gray-300)', background: 'transparent', color: 'var(--grape)',
              borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}>
            + Adicionar faixa
          </button>
        </div>
        {temErro && (
          <p style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600, marginTop: 12 }}>
            Corrija as faixas destacadas em vermelho antes de salvar.
          </p>
        )}
      </Bloco>

      <Bloco icone="💳" titulo="Retorno da maquininha"
        descricao="Acréscimo cobrado quando o motoboy precisa levar a maquininha física (Débito/Crédito). Dinheiro e PIX nunca acionam esse acréscimo.">
        <ToggleRow titulo="Cobrar retorno da maquininha" ativo={maqAtivo} onChange={(v) => { setMaqAtivo(v); setMsg(null); }} />
        <div className="form-group" style={{ marginTop: 14, maxWidth: 200 }}>
          <label className="form-label">Valor (R$)</label>
          <input className="form-input" type="number" step="0.01" min="0" value={maqValor} disabled={!maqAtivo}
            onChange={(e) => { setMaqValor(e.target.value); setMsg(null); }} />
          {!maqValorOk && <p style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>Informe um valor válido (≥ 0).</p>}
        </div>
      </Bloco>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <button type="button" onClick={salvar} disabled={!podeSalvar}
          style={{
            padding: '11px 20px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-body)',
            cursor: podeSalvar ? 'pointer' : 'default',
            background: podeSalvar ? 'var(--grape)' : 'var(--gray-200)',
            color: podeSalvar ? '#fff' : 'var(--gray-500)',
          }}>
          💾 {salvando ? 'Salvando…' : 'Salvar Alterações'}
        </button>
        {!mudou && !msg && <span style={{ fontSize: 12.5, color: 'var(--gray-400)' }}>Nenhuma alteração pendente.</span>}
        {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</span>}
      </div>
    </>
  );
}

export function AdminTaxaEntrega() {
  const info = useCompanyInfo();
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 19, fontWeight: 700, margin: 0 }}>🚚 Taxa de Entrega</h2>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
          Cobrança automática por distância — substitui a definição manual de taxa. Nenhum valor fica fixo no
          código: tudo aqui é editável, sem precisar de deploy.
        </p>
      </div>
      <StatusLocalizacaoLoja configurada={localizacaoLojaConfigurada(info)} />
      <BlocoLocalizacao />
      <BlocoFaixas />
    </div>
  );
}
