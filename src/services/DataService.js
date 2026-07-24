/* services/DataService.js — Único Ponto de Acesso a Dados (REF-APP-01 · Onda 2, MOVE PURO do App.jsx).
   O objeto DS foi movido byte-a-byte de App.jsx (baseline 6b0517e, L37→L230): mesmos métodos, mesma
   ordem, mesmos contratos de retorno, os mesmos singletons de cache e o mesmo uso de `this`.
   NENHUMA mudança de comportamento — apenas realocação. Consumidores seguem chamando DS.metodo(...)
   via `import { DS } from './services/DataService.js'` (objeto único; nunca desestruturar → preserva this).
   Camada services: importa só lib/supabase (db, RPC_TIMEOUT), constants/catalogConfig e utils/catalog
   (prodInCat) — nunca pricing/addons/format (D2 / G-CK1 do test:deps permanecem verdes). */
import { db, RPC_TIMEOUT } from '../lib/supabase.js';
import { PRODUCTS_PAGE_SIZE, PRODUCTS_PAGINATE, PRODUCTS_CACHE_TTL } from '../constants/catalogConfig.js';
import { prodInCat } from '../utils/catalog.js';
import { emitProductsChanged } from './productCacheBus.js';

/* FIX (achado REF-E2E-03 · Onda 3): `categories.slug` é NOT NULL sem default no banco — usado só
   por upsertCat (criação de categoria nova). Sufixo curto evita colisão sem consultar unicidade. */
function slugifyCategoria(nome) {
  const base = String(nome || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${base || 'categoria'}-${Date.now().toString(36)}`;
}

export const DS = {
  /* HARDENING — cache global leve da lista COMPLETA de produtos (só quando NÃO há
     `search`): reduz fetchAllProductsSafe duplicado ao navegar entre categorias (o
     filtro de categoria é client-side, então a mesma lista serve todas). Invisível ao
     frontend; TTL = PRODUCTS_CACHE_TTL; invalidado em qualquer escrita de produto. */
  _globalProductsCache: null,
  _globalProductsCacheTime: 0,
  _invalidateProductsCache() { this._globalProductsCache = null; this._globalProductsCacheTime = 0; },
  async run(fn, { throwOnError = false } = {}) {
    if (!db) {
      if (throwOnError) throw new Error('Supabase indisponível (offline).');
      return {data:null,error:{message:'offline'}};
    }
    try {
      const res = await fn(db);
      // Erros lógicos do Supabase chegam em res.error (não são lançados).
      // Em operações de escrita (throwOnError), propagar para não falhar em silêncio.
      if (res && res.error && throwOnError) throw res.error;
      return res;
    } catch(e) {
      console.warn('[DS]', e?.message || e);
      if (throwOnError) throw e;
      return {data:null,error:e};
    }
  },
  /* Busca TODOS os produtos contornando o teto de ~1000 linhas do PostgREST.
     makeQuery(d) devolve a query base (select+filtros+order) já pronta; aqui só
     aplicamos .range() e acumulamos. Retorna {data,error} no MESMO formato de run(),
     para getProds/getAllProds tratarem erro/offline exatamente como antes.
     Requer ordenação TOTAL (order primário + desempate por id) p/ o range não pular
     nem repetir linhas entre páginas — por isso getProds/getAllProds acrescentam
     .order('id'). Com PRODUCTS_PAGINATE=false, faz 1 chamada (comportamento legado). */
  async fetchAllProductsSafe(makeQuery) {
    if (!PRODUCTS_PAGINATE) return this.run(d => makeQuery(d));   /* rollback: select direto */
    const acc = [];
    for (let from = 0; ; from += PRODUCTS_PAGE_SIZE) {
      const to = from + PRODUCTS_PAGE_SIZE - 1;
      const r = await this.run(d => makeQuery(d).range(from, to));
      if (r.error) return { data: null, error: r.error };        /* propaga erro/offline → fallback MOCK */
      const page = r.data ?? [];
      acc.push(...page);
      if (page.length < PRODUCTS_PAGE_SIZE) break;               /* página incompleta → fim */
      console.warn('[DS] Página retornou pageSize completo — possível continuação');  /* guardrail */
    }
    return { data: acc, error: null };
  },
  async getCats() {
    /* Retorna array (vazio ou com dados) quando banco responde; null quando offline/erro */
    const r = await this.run(d=>d.from('categories').select('*').eq('ativo',true).order('ordem'));
    if (r.error && r.error.message !== 'offline') console.warn('[DS] getCats error:', r.error.message);
    return r.error ? null : (r.data ?? []);
  },
  async getAllCats() {
    const r = await this.run(d=>d.from('categories').select('*').order('ordem'));
    return r.error ? null : (r.data ?? []);
  },
  async getProds(catId, search) {
    /* Faz join com categorias para trazer o nome da categoria junto com o produto.
       Sempre busca todos os produtos disponíveis e filtra no cliente para suportar
       o campo categoria_ids (array de múltiplas categorias) sem alterar o schema. */
    /* Cache global: como a busca por categoria é client-side, a lista COMPLETA (sem
       `search`) serve qualquer catId — servimos do cache e só aplicamos prodInCat.
       Busca server-side (search) nunca usa cache (sempre fresca). Invisível ao front. */
    const cacheavel = !search;
    let data;
    if (cacheavel && this._globalProductsCache && (Date.now() - this._globalProductsCacheTime) < PRODUCTS_CACHE_TTL) {
      data = this._globalProductsCache;
    } else {
      const r = await this.fetchAllProductsSafe(d=>{
        let q = d.from('products')
          .select('*, categories(id, nome, icone, cor)')
          .eq('disponivel', true);
        if (search) q = q.ilike('nome', `%${search}%`);
        return q.order('ordem', { ascending: true }).order('id', { ascending: true });
      });
      if (r.error && r.error.message !== 'offline') console.warn('[DS] getProds error:', r.error.message);
      if (r.error) return null;
      data = r.data ?? [];
      if (cacheavel) { this._globalProductsCache = data; this._globalProductsCacheTime = Date.now(); }
    }
    /* Filtro de categoria no cliente — suporta categoria_id (legado) e categoria_ids (novo) */
    return catId ? data.filter(p => prodInCat(p, catId)) : data;
  },
  async getAllProds() {
    const r = await this.fetchAllProductsSafe(d=>d.from('products').select('*, categories(id, nome, icone, cor)').order('nome').order('id', { ascending: true }));
    return r.error ? null : (r.data ?? []);
  },
  async getAds() {
    const r = await this.run(d=>d.from('adicionais').select('*').eq('ativo',true).order('nome'));
    return r.data?.length ? r.data : null;
  },
  async getAllAds() {
    const r = await this.run(d=>d.from('adicionais').select('*').order('nome'));
    return r.data ?? null;
  },
  /* HARDEN-ORDERS-03/04: persistência transacional + idempotente via RPC create_order.
     1 chamada → customer (reuso por telefone normalizado) + order + order_items, atômico.
     requestId (idempotency key): mesma key → devolve o pedido já criado (sem duplicar).
     HARDEN-04: timeout defensivo (não congela o checkout) + 1 retry idempotente em falha de rede.
     Retorna o uuid do pedido, ou null em erro/offline (o erro é logado, nunca escondido).
     A RPC responde jsonb {ok, order_id|error, sqlstate, idempotent}. */
  async savePedido(cliente, order, itens, requestId) {
    const call = () => this.run(d=>d.rpc('create_order', {
      p_customer: cliente, p_order: order, p_items: itens, p_request_id: requestId ?? null,
    }));
    const withTimeout = p => Promise.race([p,
      new Promise(res => setTimeout(() => res({ data:null, error:{ message:'timeout' } }), RPC_TIMEOUT))]);
    let r = await withTimeout(call());
    if (r.error && requestId) r = await withTimeout(call());   // 1 retry seguro (mesma idempotency key)
    if (r.error) { console.error('[ENCANTO] create_order erro de rede/timeout:', r.error.message || r.error); return null; }
    const res = r.data;   // {ok, order_id|error, sqlstate, idempotent}
    if (res && res.ok === false) {
      console.error('[ENCANTO] create_order falhou (rollback no banco):', res.error, '['+res.sqlstate+']');
      return null;
    }
    return res?.order_id ?? null;
  },
  async getPedidos() {
    const r = await this.run(d=>d.from('orders')
      .select('*, customers(name,phone), order_items(*)')
      .order('created_at',{ascending:false}).limit(100));
    return r.data ?? [];
  },
  async setStatus(id,status) {
    await this.run(d=>d.from('orders').update({status}).eq('id',id));
  },
  /* REF-ORDER-01 · Parte 2 — historico de status de UM pedido (visao admin: is_admin ve tudo).
     select('*') e proposital: sobrevive a migration que adiciona a coluna `ator` (antes: ausente; depois:
     presente) sem quebrar o front. O registro de eventos em cada troca de status e feito por TRIGGER no
     banco (SECURITY DEFINER) — fonte unica, cobre qualquer canal que altere orders.status. */
  async getEventos(orderId) {
    if (!orderId) return [];
    const r = await this.run(d=>d.from('order_events').select('*').eq('order_id',orderId).order('created_at',{ascending:true}));
    return r.data ?? [];
  },
  /* REF-ORDER-01 · Parte 1 — total de pedidos ja realizados por um cliente (contagem HEAD, sem trazer linhas).
     Usado na comanda ("Pedidos realizados: N"). Retorna null quando indisponivel (nunca fabrica 0). */
  async countPedidosByCustomer(customerId) {
    if (!customerId) return null;
    const r = await this.run(d=>d.from('orders').select('id',{count:'exact',head:true}).eq('customer_id',customerId));
    return typeof r.count === 'number' ? r.count : null;
  },
  /* REF-ORDER-01 · Parte 3 — estado das notificacoes de UM pedido (fila notification_outbox, so admin via RLS).
     Observabilidade no painel: mostra o que foi/sera enviado por status. ANTES da migration aplicada a
     tabela nao existe -> a query falha e devolvemos [] (degrada sem quebrar a UI). */
  async getNotificacoes(orderId) {
    if (!orderId) return [];
    const r = await this.run(d=>d.from('notification_outbox')
      .select('id, status, state, to_phone, message, last_error, attempts, created_at, sent_at')
      .eq('order_id', orderId).order('created_at',{ascending:true}));
    return r.error ? [] : (r.data ?? []);
  },
  /* HARDEN-06: snapshot de saúde (orders_health) p/ o painel admin. */
  async getHealth() {
    const r = await this.run(d=>d.rpc('orders_health'));
    return r.data ?? null;
  },
  /* HARDEN-06: log genérico em application_logs — reutilizável por qualquer módulo (best-effort, sem PII). */
  async logEvent(module, operation, level, message, payload) {
    try {
      await this.run(d=>d.from('application_logs').insert({
        module, operation, level: level||'info',
        message: String(message||'').slice(0,500), payload: payload||null,
        version: 'harden-06', origin: 'web',
      }));
    } catch (e) { /* nunca quebrar o fluxo por causa de log */ }
  },
  async upsertCat(data,id) {
    if (id) await this.run(d=>d.from('categories').update(data).eq('id',id));
    /* FIX (achado REF-E2E-03): `categories.slug` é NOT NULL sem default — o insert sem essa
       coluna sempre violava a constraint, e o erro (nunca checado aqui) fazia "+ Nova" fechar o
       modal como se tivesse funcionado, sem criar linha nenhuma. Gera um slug a partir do nome +
       sufixo curto (evita colisão sem depender de índice único explícito). */
    else    await this.run(d=>d.from('categories').insert({...data,ativo:true,slug:slugifyCategoria(data.nome)}));
  },
  async delCat(id)  { await this.run(d=>d.from('categories').delete().eq('id',id)); },
  /* ── CORREÇÃO CRÍTICA DE IMAGEM ──────────────────────────────
     Regras:
     1. NUNCA salvar base64 — rejeitar se começar com 'data:'
     2. Se image_url for string vazia ou undefined ao EDITAR → remover do payload
        para NÃO sobrescrever a imagem existente no banco
     3. Aceitar null explicitamente (admin quis remover a imagem)
     4. Ao CRIAR: salvar null se não houver URL válida
  ────────────────────────────────────────────────────────────── */
  _sanitizeImageUrl(url) {
    if (!url)                          return null; // null ou undefined → null
    if (typeof url !== 'string')       return null;
    if (url.trim() === '')             return null; // string vazia → null
    if (url.startsWith('data:'))       return null; // base64 NUNCA salvar
    if (!url.startsWith('http'))       return null; // URL inválida → null
    return url.trim();
  },
  async upsertProd(data, id) {
    // Clonar para não mutar o objeto original
    const payload = { ...data };

    if (id) {
      // EDIÇÃO: só incluir image_url no UPDATE se foi explicitamente fornecida
      // Isso evita sobrescrever a imagem existente ao salvar outros campos
      if ('imagem_url' in payload) {
        const sanitized = this._sanitizeImageUrl(payload.imagem_url);
        if (sanitized === null && payload.imagem_url !== null) {
          // URL inválida (vazia, base64, etc.) → remover do payload para preservar existente
          delete payload.imagem_url;
        } else {
          payload.imagem_url = sanitized; // null explícito ou URL válida
        }
      }
      await this.run(d => d.from('products').update(payload).eq('id', id), { throwOnError: true });
    } else {
      // CRIAÇÃO: sanitizar sempre
      payload.imagem_url = this._sanitizeImageUrl(payload.imagem_url);
      await this.run(d => d.from('products').insert(payload), { throwOnError: true });
    }
    this._invalidateProductsCache();
    emitProductsChanged();   /* PRICE-DOMAIN-01: invalida tambem o cache de sessao da loja (hooks/useProducts) */
  },
  async toggleProd(id,disponivel) { await this.run(d=>d.from('products').update({disponivel}).eq('id',id)); this._invalidateProductsCache(); emitProductsChanged(); },
  async delProd(id) { await this.run(d=>d.from('products').delete().eq('id',id)); this._invalidateProductsCache(); emitProductsChanged(); },
  async upsertAd(data,id) {
    if (id) await this.run(d=>d.from('adicionais').update(data).eq('id',id));
    else    await this.run(d=>d.from('adicionais').insert({...data,ativo:true}));
  },
  async delAd(id)   { await this.run(d=>d.from('adicionais').delete().eq('id',id)); },
};
