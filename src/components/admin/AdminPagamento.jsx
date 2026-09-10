/* components/admin/AdminPagamento.jsx — REF-PAGAMENTO-01 · Onda 7.
   Aba "Pagamento" do Admin — primeira tela de self-service desta REF (Ondas 0-6 dependiam de mim
   rodando SQL direto). Controla, por loja: liga/desliga o Payment Brick (Pix + cartão) no checkout e
   a Chave Pública (Public Key) usada para montar o SDK no navegador do cliente.

   Fluxo: mesmo padrão de AdminEmpresa (form PENDENTE, "Salvar Alterações" único, servidor sempre
   revalida) — não o padrão de toggle instantâneo (WhatsApp flutuante), porque aqui o toggle e a chave
   são INTERDEPENDENTES (não dá pra habilitar sem chave válida) e precisam ser confirmados juntos.

   ESCOPO CONSCIENTE desta onda (decisão explícita do dono): só o que já é seguro circular por aqui —
   a Public Key é pública por design do próprio Mercado Pago. O Access Token (quem decide pra qual
   CONTA o dinheiro vai de verdade) continua fora do Admin, é segredo de Edge Function configurado
   fora daqui — por isso hoje só 1 conta Mercado Pago recebe o dinheiro de TODAS as lojas com esta
   capability ligada, mesmo que cada uma tenha sua própria chave pública. Isso é dito explicitamente
   na tela (bloco "Como funciona hoje"), não escondido. Resolver isso de vez é escopo de uma REF futura
   de Split/OAuth (cada loja conecta a própria conta Mercado Pago) — fora desta onda. */
import { useState, useEffect, useMemo } from 'react';
import { usePagamentoConfig } from '../../hooks/usePagamentoConfig.js';
import { salvarPagamentoConfig } from '../../pagamento/services/pagamentoConfig.js';

const FORMATO_CHAVE = /^(TEST|APP_USR)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ambienteDaChave(chave) {
  const v = (chave || '').trim();
  if (!v) return null;
  if (/^TEST-/i.test(v)) return { label: '🧪 Ambiente de Teste (sandbox)', cor: '#B45309', fundo: '#FEF3C7' };
  if (/^APP_USR-/i.test(v)) return { label: '✅ Ambiente de Produção', cor: '#15803D', fundo: '#F0FDF4' };
  return { label: '⚠️ Prefixo não reconhecido', cor: '#B91C1C', fundo: '#FEF2F2' };
}

function Bloco({ icone, titulo, descricao, children }) {
  return (
    <div className="admin-card" style={{ marginBottom: 20 }}>
      <div className="admin-card-header"><h3>{icone} {titulo}</h3></div>
      <div style={{ padding: 20 }}>
        {descricao && <p style={{ fontSize: 13, color: 'var(--gray-500)', marginBottom: 18, lineHeight: 1.6 }}>{descricao}</p>}
        {children}
      </div>
    </div>
  );
}

function paraForm(cfg) {
  return { habilitada: !!cfg.habilitada, publicKey: cfg.public_key || '' };
}

export function AdminPagamento() {
  const oficial = usePagamentoConfig();
  const [form, setForm] = useState(() => paraForm(oficial));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null); // { tipo:'ok'|'erro', texto }

  const oficialKey = useMemo(() => JSON.stringify(paraForm(oficial)), [oficial]);
  useEffect(() => { setForm(paraForm(oficial)); }, [oficialKey]);

  const mudou = oficialKey !== JSON.stringify(form);
  const chaveTrim = form.publicKey.trim();
  const chaveValida = chaveTrim === '' || FORMATO_CHAVE.test(chaveTrim);
  const erroChave = !chaveValida ? 'Formato inválido — use a Public Key do Mercado Pago (TEST-... ou APP_USR-...), não o Access Token.' : null;
  const erroHabilitarSemChave = form.habilitada && chaveTrim === '' ? 'Informe a chave pública antes de habilitar o pagamento online.' : null;
  const podeSalvar = mudou && !salvando && chaveValida && !erroHabilitarSemChave;
  const ambiente = ambienteDaChave(chaveTrim);

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true); setMsg(null);
    const r = await salvarPagamentoConfig(form.habilitada, chaveTrim);
    setSalvando(false);
    if (r.ok) setMsg({ tipo: 'ok', texto: 'Configuração de pagamento salva com sucesso.' });
    else setMsg({ tipo: 'erro', texto: r.error || 'Não foi possível salvar.' });
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontFamily: 'var(--font-head)', fontSize: 19, fontWeight: 700, margin: 0 }}>💳 Pagamento Online</h2>
        <p style={{ fontSize: 13, color: 'var(--gray-500)', marginTop: 4 }}>
          Pix e cartão direto no checkout, via Mercado Pago — o cliente paga sem sair da loja.
        </p>
      </div>

      <Bloco icone="🔌" titulo="Status" descricao="Com o pagamento online desligado, o cliente só vê as formas de pagamento na entrega/retirada (dinheiro, maquininha).">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
          padding: '14px 16px', background: 'var(--gray-50)', borderRadius: 10,
        }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--gray-700)' }}>Pagamento online (Pix + Cartão) no checkout</div>
            <div style={{ fontSize: 11.5, color: 'var(--gray-500)', marginTop: 2 }}>Aplica só depois de "Salvar Alterações".</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span data-testid="pagamento-status-badge" style={{
              fontSize: 12, fontWeight: 700, color: form.habilitada ? '#15803D' : '#B91C1C',
              background: form.habilitada ? '#F0FDF4' : '#FEF2F2', padding: '4px 12px', borderRadius: 20,
            }}>{form.habilitada ? '🟢 Ligado' : '🔴 Desligado'}</span>
            <label className="toggle-switch">
              <input data-testid="pagamento-toggle-habilitada" type="checkbox" checked={form.habilitada}
                onChange={(e) => { setForm((f) => ({ ...f, habilitada: e.target.checked })); setMsg(null); }} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
        {erroHabilitarSemChave && (
          <p style={{ fontSize: 12.5, color: '#DC2626', marginTop: 10, fontWeight: 600 }}>⚠️ {erroHabilitarSemChave}</p>
        )}
      </Bloco>

      <Bloco icone="🔑" titulo="Chave Pública (Public Key)"
        descricao="Encontre em: Mercado Pago Developers → sua aplicação → Credenciais de produção/teste → Public Key. É um dado público, sem risco em preencher aqui — nunca cole o Access Token neste campo.">
        <div className="form-group">
          <label className="form-label">Public Key</label>
          <input
            className="form-input" data-testid="pagamento-form-public-key"
            placeholder="TEST-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={form.publicKey}
            onChange={(e) => { setForm((f) => ({ ...f, publicKey: e.target.value })); setMsg(null); }}
            style={{ fontFamily: 'monospace', fontSize: 12.5 }}
          />
          {erroChave && <p style={{ fontSize: 11.5, color: '#DC2626', marginTop: 6, fontWeight: 600 }}>⚠️ {erroChave}</p>}
        </div>
        {ambiente && chaveValida && (
          <span data-testid="pagamento-ambiente-badge" style={{
            display: 'inline-block', fontSize: 11.5, fontWeight: 700, color: ambiente.cor,
            background: ambiente.fundo, padding: '4px 12px', borderRadius: 20, marginTop: 4,
          }}>{ambiente.label}</span>
        )}
      </Bloco>

      <Bloco icone="ℹ️" titulo="Como funciona hoje">
        <ul style={{ fontSize: 13, color: 'var(--gray-600)', lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li>O cliente escolhe Pix ou cartão dentro do próprio checkout — aprovação em segundos, sem precisar confirmar nada no WhatsApp antes.</li>
          <li>A confirmação do pedido (e o envio pro WhatsApp da loja) só acontece <strong>depois</strong> do pagamento ser aprovado de verdade pelo Mercado Pago.</li>
          <li>O <strong>Access Token</strong> (quem decide para qual conta bancária o dinheiro vai) não fica nesta tela — é configurado à parte, de forma segura.</li>
          <li>
            <strong>Importante:</strong> hoje existe <strong>uma única conta Mercado Pago</strong> recebendo o
            dinheiro de todas as lojas que ligarem este recurso, mesmo que cada uma tenha sua própria chave
            pública aqui. Cada loja receber na <strong>própria</strong> conta é uma evolução futura (conexão
            direta com o Mercado Pago de cada lojista).
          </li>
        </ul>
      </Bloco>

      <Bloco icone="💸" titulo="Referência de taxas do Mercado Pago"
        descricao="Valores de referência de mercado — as taxas reais da SUA conta (que podem variar por volume/negociação) ficam sempre no painel do Mercado Pago, nunca aqui.">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Pix', valor: '0%*' },
            { label: 'Crédito à vista', valor: '~4,98%' },
            { label: 'Crédito parcelado', valor: '~3,98%' },
            { label: 'Débito', valor: '~1,99%' },
          ].map((t) => (
            <div key={t.label} style={{ flex: '1 1 130px', border: '1px solid var(--gray-200)', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 11.5, color: 'var(--gray-500)', fontWeight: 600 }}>{t.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--gray-700)', marginTop: 2 }}>{t.valor}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 10 }}>
          *0% para a maioria das contas; o Mercado Pago pode cobrar uma taxa pequena sobre Pix de contas com CNPJ e faturamento alto. Confirme sempre no seu painel Mercado Pago.
        </p>
      </Bloco>

      <div style={{ borderTop: '1px solid var(--gray-200)', marginTop: 8, paddingTop: 24, textAlign: 'center' }}>
        <button className="btn-primary" onClick={salvar} disabled={!podeSalvar} data-testid="pagamento-salvar-btn"
          style={{ minWidth: 260, padding: '14px 28px', fontSize: 16, fontWeight: 700, borderRadius: 12 }}>
          💾 {salvando ? 'Salvando…' : 'Salvar Alterações'}
        </button>
        {!mudou && !msg && <p style={{ fontSize: 12.5, color: 'var(--gray-400)', marginTop: 10 }}>Nenhuma alteração pendente.</p>}
        {msg && (
          <p data-testid="pagamento-msg" style={{ fontSize: 13, marginTop: 10, fontWeight: 600, color: msg.tipo === 'ok' ? '#16A34A' : '#DC2626' }}>{msg.texto}</p>
        )}
      </div>
    </div>
  );
}
