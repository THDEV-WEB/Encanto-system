/* services/company/companyInfoRules.js — REF-COMPANY-01 (+03: Central de Configuração da Empresa).
   Regras PURAS dos dados institucionais da empresa: defaults, formatacao de telefone e validacao de
   patch. ZERO IO (sem Supabase, sem window/localStorage) — import seguro em Node puro
   (tests/company-info.golden.mjs). Espelha a separacao pura/IO ja usada em
   services/businessHours/businessHours.js (puro) vs services/businessHours/override.js (IO): o modulo
   com efeito (companyInfo.js) importa daqui; nunca o contrario.

   REF-COMPANY-03 (escopo ampliado): a tela "Empresa" do Admin vira uma CENTRAL DE CONFIGURAÇÃO
   institucional — tudo ainda dentro de company_info (settings), sem tabela nova, sem RPC nova. Campos
   MANTIDOS FLAT (nunca aninhados em sub-objeto): set_company_info faz merge RASO no servidor
   (`COALESCE(atual,'{}') || p_patch`) — um patch parcial de um sub-objeto ("social": {...}) apagaria os
   irmãos não enviados dentro dele. Flat evita essa armadilha e segue o padrão já usado desde a
   REF-COMPANY-01 (nome/telefone/etc.). Grupos (só organização visual no Admin, não no dado):
     Identidade    -> nomeCurto, nomeCompleto (Logo/Favicon ainda SEM campo — ver AdminEmpresa.jsx, são
                       só placeholders "Em breve" na tela, sem upload/persistência nesta entrega)
     Contato       -> telefone, whatsapp, email, whatsappFloatEnabled
     Sobre         -> sobre (migrado de constants/storeInfo.js, SOBRE_TEXTO removido)
     Redes sociais -> instagram, facebook, tiktok, site, cardapio, googleMaps (URLs; SideDrawer.jsx
                       consome e OCULTA o ícone quando o campo está vazio — nunca link morto)
     Endereço      -> cep, rua, numero, bairro, cidade, estado — ENDEREÇO INSTITUCIONAL, entidade
                       INDEPENDENTE do endereço de RETIRADA do checkout (STORE_INFO.retirada,
                       constants/storeInfo.js) — nunca cruzar essas duas fontes.
     Institucional -> cnpj, razaoSocial, nomeFantasia
     Configurações -> timezone, idioma, moeda — PERSISTIDOS já, mas SEM nenhuma ligação funcional com o
                       motor de horário (services/businessHours, que já normaliza seu próprio timezone
                       no servidor desde a HB-04) — preparação para evolução futura, não uma feature ativa.

   REF-DELIVERY-FEE-01: lojaLat/lojaLng — coordenada OPERACIONAL da loja (arrastar pino no mapa, Admin >
   Taxa de Entrega), usada SOMENTE para calcular a distância até o cliente (services/delivery/
   deliveryFeeRules.js). Entidade INDEPENDENTE do endereço institucional (cep/rua/... acima, usado em
   documentos/rodapé) e do endereço de RETIRADA do checkout (STORE_INFO.retirada, texto) — nunca cruzar
   com essas duas fontes. null = loja ainda não posicionou o pino. Segue o mesmo precedente da REF-COMPANY-03
   (campo novo dentro do MESMO patch/merge raso do servidor, sem tabela/RPC nova); validação NUMÉRICA fica
   só no cliente (o risco de coordenada inválida é baixo impacto — pior caso, o cálculo cai no fallback
   "sem coordenadas", nunca cobra errado, ver deliveryFeeRules.montarResumoFinanceiro).

   REF-SAAS-01 · Onda 6.2 (branding por loja — company_info migrou de settings global para
   store_settings por loja, mesmo padrão da Onda 4.3): 7 campos novos, TODOS aplicados só ao bundle do
   STOREFRONT (StoreApp.jsx) — o Admin (REF-ADMIN-04) já trata seus próprios ícones como identidade
   neutra da VALION, não skinada por loja.
     Identidade  -> logoUrl, faviconUrl (null = usa o asset estático do repo; AdminEmpresa.jsx usa
                    ImageUploader, mesmo componente já em produção para imagem de produto, bucket
                    Storage "products", subpasta "branding/")
     Paleta      -> corPrimaria, corSecundaria, corDestaque (hex #RRGGBB; aplicados em runtime nas
                    custom properties --magenta/--grape, --roxo/--acai, --amarelo — StoreApp.jsx)
     Institucional -> termosSecoes (array {titulo,corpo}), fidelidadeTexto (array de parágrafos) —
                    aposentam TERMOS_SECOES/FIDELIDADE_TEXTO (constants/storeInfo.js), mesmo padrão já
                    usado por "sobre" desde a REF-COMPANY-03. Defaults abaixo são BYTE-IDÊNTICOS ao que
                    já está hardcoded hoje — zero mudança visual no dia da migração.

   REF-SAAS-01 · Onda 7.1 (WhatsApp operacional multi-tenant): nomeCurto/nomeCompleto/telefone/whatsapp/
   email/whatsappFloatEnabled deixam de default para a identidade/número REAIS da Encanto — como o
   storefront é um bundle ÚNICO multi-tenant (Onda 6.1, ADR §5), esses defaults são compartilhados por
   TODAS as lojas no instante antes de get_company_info() resolver; manter dados reais da Encanto aqui
   seria vazar a identidade/WhatsApp de um tenant específico para qualquer outra loja, mesmo que por
   uma fração de segundo. Passam a ser genéricos ("Loja") ou vazios ("" / false) — o mesmo "estado
   honesto de não configurado" já usado por lojaLat/lojaLng/redes sociais/endereço institucional, nunca
   um dado real de outra loja. Mesma mudança espelhada no default SQL de get_company_info() (migration
   REF-SAAS-01-onda7-1-whatsapp-multi-loja.sql) — a Encanto não é afetada em nenhum dos dois lados: sua
   linha em store_settings já tem os 6 campos salvos explicitamente. */
import { normalizePhoneBR } from '../notifications/WhatsAppService.js';

export const DEFAULT_COMPANY_INFO = {
  // Identidade
  nomeCurto: 'Loja',
  nomeCompleto: 'Loja',
  // Contato
  telefone: '',
  whatsapp: '',
  email: '',
  whatsappFloatEnabled: false,
  // Sobre — REF-SAAS-02 · Onda 2 (achado real da auditoria: a Encanto nunca teve `sobre` persistido
  // em `store_settings`; este texto SEMPRE foi o real "Sobre nós" dela, só vivia hardcoded aqui — um
  // fallback silencioso que vazaria a identidade da Encanto pra qualquer loja nova sem `sobre` próprio,
  // o mesmo problema que a Onda 7.1 já corrigiu pra nomeCurto/telefone/whatsapp/email. Fix: a Encanto
  // ganhou o mesmo texto gravado explicitamente (set_company_info, dado operacional, zero mudança
  // visual pra ela); este default passa a ser genérico, igual ao resto dos campos desta lista.
  sobre: 'Conte a história da sua loja aqui — edite este texto na tela Empresa.',
  // Redes sociais (vazio = "não configurado ainda"; nunca um placeholder fake)
  instagram: '',
  facebook: '',
  tiktok: '',
  site: '',
  cardapio: '',
  googleMaps: '',
  // Endereço institucional (independente do endereço de retirada do checkout)
  cep: '',
  rua: '',
  numero: '',
  bairro: '',
  cidade: '',
  estado: '',
  // Informações institucionais
  cnpj: '',
  razaoSocial: '',
  nomeFantasia: '',
  // Configurações (preparo — sem comportamento funcional ainda)
  timezone: 'America/Sao_Paulo',
  idioma: 'pt-BR',
  moeda: 'BRL',
  // Localização operacional da loja (REF-DELIVERY-FEE-01) — ver comentário de cabeçalho.
  lojaLat: null,
  lojaLng: null,
  // Branding por loja (REF-SAAS-01 · Onda 6.2) — ver comentário de cabeçalho.
  logoUrl: null,
  faviconUrl: null,
  bannerUrl: null,
  logoPreset: 'organico',
  corPrimaria: '#A62786',
  corSecundaria: '#6B1F5D',
  corDestaque: '#FFBF00',
  termosSecoes: [
    { titulo: 'Uso do serviço', corpo: 'Ao realizar um pedido você concorda com as condições de compra, prazos de entrega e formas de pagamento informadas no checkout.' },
    { titulo: 'Privacidade', corpo: 'Coletamos apenas os dados necessários para processar o seu pedido (nome, contato e endereço). Não compartilhamos seus dados com terceiros sem necessidade operacional.' },
    { titulo: 'Cancelamento e trocas', corpo: 'Pedidos em preparo podem ter regras específicas de cancelamento. Em caso de problemas, fale conosco pelo WhatsApp.' },
    { titulo: 'Contato', corpo: 'Dúvidas sobre estes termos podem ser tratadas pelos nossos canais de contato.' },
  ],
  fidelidadeTexto: [
    'A cada pedido você acumula um selo no seu cartão de fidelidade.',
    'Ao completar a cartela, você ganha um benefício especial no próximo pedido.',
    'Entre na sua conta para acompanhar seus selos em qualquer dispositivo (em breve).',
  ],
};

const emailValido = (e) => /.+@.+\..+/.test((e || '').trim());
const urlValida = (u) => /^https?:\/\/.+/i.test((u || '').trim());

/* Formata E.164 BR ('55DDNNNNNNNNN') para exibicao humana '(DD) 9NNNN-NNNN'. Pura, sem estado. */
export function formatarTelefoneBR(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  const local = (d.length > 11 && d.startsWith('55')) ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits ? String(digits) : '';
}

/* Campo de URL OPCIONAL: vazio é sempre valido ("ainda nao configurado"); se preenchido, precisa
   parecer uma URL (http/https). Usado pelos 6 campos de redes sociais/links. */
function validarUrlOpcional(p, campo, rotulo) {
  if (!(campo in p)) return null;
  const v = String(p[campo] || '').trim();
  if (v && !urlValida(v)) return `${rotulo} inválido — use um link completo (https://...) ou deixe em branco.`;
  p[campo] = v;
  return null;
}

/* Campo de TEXTO LIVRE opcional: so trim, sem regra de formato (endereco/institucional). */
function aplicarTextoOpcional(p, campo) {
  if (campo in p) p[campo] = String(p[campo] || '').trim();
}

/* Valida/normaliza um PATCH no CLIENTE (evita round-trip obvio); a validacao que vale sempre e a do
   servidor (set_company_info revalida tudo, e e a UNICA fonte de verdade). Telefone/whatsapp reusam o
   MESMO normalizador do resto do projeto (normalizePhoneBR) — nao inventa uma 4a regra de telefone.
   Retorna { patch } normalizado ou { erro }. */
export function validarPatchCompanyInfo(patch) {
  const p = { ...patch };
  if ('nomeCurto' in p) {
    const n = String(p.nomeCurto || '').trim();
    if (n.length < 2) return { erro: 'Informe o nome curto da empresa (mínimo 2 caracteres).' };
    p.nomeCurto = n;
  }
  if ('nomeCompleto' in p) {
    const n = String(p.nomeCompleto || '').trim();
    if (n.length < 2) return { erro: 'Informe o nome completo da empresa (mínimo 2 caracteres).' };
    p.nomeCompleto = n;
  }
  // REF-SAAS-02 · Onda 2 (bug real achado em teste E2E): vazio é um estado VÁLIDO ("ainda não
  // configurado" — a própria UI mostra um aviso amarelo pra esse caso). paraPatch() do AdminEmpresa.jsx
  // inclui telefone/whatsapp em TODO save (mesmo quando o admin só mudou outro campo) — sem este ajuste,
  // uma loja nova (telefone/whatsapp vazios por padrão) nunca conseguia salvar NADA nesta tela.
  if ('telefone' in p) {
    const t = normalizePhoneBR(p.telefone);
    if (t && (t.length < 12 || t.length > 13)) return { erro: 'Telefone inválido. Informe DDD + número, ou deixe em branco.' };
    p.telefone = t;
  }
  if ('whatsapp' in p) {
    const w = normalizePhoneBR(p.whatsapp);
    if (w && (w.length < 12 || w.length > 13)) return { erro: 'WhatsApp inválido. Informe DDD + número, ou deixe em branco.' };
    p.whatsapp = w;
  }
  // REF-SAAS-02 · Onda 2 (mesma classe de bug do telefone/whatsapp): e-mail vazio também é um estado
  // válido ("ainda não configurado"), e paraPatch() sempre inclui email no save.
  if ('email' in p) {
    const e = String(p.email || '').trim().toLowerCase();
    if (e && !emailValido(e)) return { erro: 'Digite um e-mail válido, ou deixe em branco.' };
    p.email = e;
  }
  if ('whatsappFloatEnabled' in p) p.whatsappFloatEnabled = !!p.whatsappFloatEnabled;
  if ('sobre' in p) {
    // so trim nas PONTAS (remove linha em branco acidental do inicio/fim); quebras de linha e
    // paragrafos internos preservados EXATAMENTE como digitados (SobreScreen renderiza com pre-wrap).
    const s = String(p.sobre || '').trim();
    if (s.length < 10) return { erro: 'Texto "Sobre nós" muito curto (mínimo 10 caracteres).' };
    p.sobre = s;
  }

  // Redes sociais — todas OPCIONAIS; vazio e sempre valido, preenchido precisa parecer uma URL.
  for (const [campo, rotulo] of [
    ['instagram', 'Instagram'], ['facebook', 'Facebook'], ['tiktok', 'TikTok'],
    ['site', 'Site'], ['cardapio', 'Link do cardápio'], ['googleMaps', 'Google Maps'],
  ]) {
    const erro = validarUrlOpcional(p, campo, rotulo);
    if (erro) return { erro };
  }

  // Endereço institucional — CEP e UF tem formato esperado (quando preenchidos); resto e texto livre.
  if ('cep' in p) {
    const digitos = String(p.cep || '').replace(/\D/g, '');
    if (digitos && digitos.length !== 8) return { erro: 'CEP inválido — use 8 dígitos ou deixe em branco.' };
    p.cep = digitos;
  }
  if ('estado' in p) {
    const uf = String(p.estado || '').trim().toUpperCase();
    if (uf && !/^[A-Z]{2}$/.test(uf)) return { erro: 'Estado (UF) inválido — use 2 letras (ex.: SC) ou deixe em branco.' };
    p.estado = uf;
  }
  for (const campo of ['rua', 'numero', 'bairro', 'cidade']) aplicarTextoOpcional(p, campo);

  // Institucional — CNPJ tem formato esperado; razão social/nome fantasia são texto livre.
  if ('cnpj' in p) {
    const digitos = String(p.cnpj || '').replace(/\D/g, '');
    if (digitos && digitos.length !== 14) return { erro: 'CNPJ inválido — use 14 dígitos ou deixe em branco.' };
    p.cnpj = digitos;
  }
  for (const campo of ['razaoSocial', 'nomeFantasia']) aplicarTextoOpcional(p, campo);

  // Configurações (preparo) — texto livre, sem regra (nenhum comportamento funcional ligado ainda).
  for (const campo of ['timezone', 'idioma', 'moeda']) aplicarTextoOpcional(p, campo);

  // Localização operacional da loja (REF-DELIVERY-FEE-01) — null é válido (limpar o pino); preenchido
  // precisa ser um número finito dentro dos limites geográficos globais (mesmos limites de
  // address/validators/addressValidators.coordenadasValidas).
  if ('lojaLat' in p) {
    const lat = p.lojaLat === null || p.lojaLat === '' ? null : Number(p.lojaLat);
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return { erro: 'Latitude da loja inválida.' };
    p.lojaLat = lat;
  }
  if ('lojaLng' in p) {
    const lng = p.lojaLng === null || p.lojaLng === '' ? null : Number(p.lojaLng);
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return { erro: 'Longitude da loja inválida.' };
    p.lojaLng = lng;
  }

  // Branding (REF-SAAS-01 · Onda 6.2 + REF-SAAS-02 · Onda 2) — logo/favicon/banner: vazio/null é válido
  // (remover); preenchido precisa parecer uma URL http(s) (mesma regra das redes sociais).
  for (const [campo, rotulo] of [['logoUrl', 'Logo'], ['faviconUrl', 'Favicon'], ['bannerUrl', 'Banner do cabeçalho']]) {
    if (!(campo in p)) continue;
    const v = p[campo] === null ? '' : String(p[campo] || '').trim();
    if (v && !urlValida(v)) return { erro: `${rotulo} inválido — use um link completo (https://...) ou remova a imagem.` };
    p[campo] = v || null;
  }

  // REF-SAAS-02 · Onda 2: apresentação da logo — só os 2 formatos suportados pelo CSS atual.
  if ('logoPreset' in p) {
    const v = String(p.logoPreset || '').trim();
    if (!['organico', 'retangular'].includes(v)) return { erro: 'Apresentação da logo inválida — escolha uma das opções.' };
    p.logoPreset = v;
  }

  // Paleta de cores — sempre um hex #RRGGBB (nunca vazio: a loja sempre tem uma cor efetiva).
  const hexValido = (v) => /^#[0-9A-Fa-f]{6}$/.test(String(v || '').trim());
  for (const [campo, rotulo] of [['corPrimaria', 'Cor primária'], ['corSecundaria', 'Cor secundária'], ['corDestaque', 'Cor de destaque']]) {
    if (!(campo in p)) continue;
    const v = String(p[campo] || '').trim();
    if (!hexValido(v)) return { erro: `${rotulo} inválida — use o formato #RRGGBB.` };
    p[campo] = v;
  }

  // Termos de uso — array de seções {titulo, corpo}, ambos texto não vazio (trim). Array vazio é
  // válido (admin removeu todas as seções deliberadamente).
  if ('termosSecoes' in p) {
    if (!Array.isArray(p.termosSecoes)) return { erro: 'Termos de uso inválido — formato inesperado.' };
    const secoes = [];
    for (const s of p.termosSecoes) {
      const titulo = String(s?.titulo || '').trim();
      const corpo = String(s?.corpo || '').trim();
      if (!titulo || !corpo) return { erro: 'Cada seção dos Termos precisa de título e texto.' };
      secoes.push({ titulo, corpo });
    }
    p.termosSecoes = secoes;
  }

  // Fidelidade — array de parágrafos (texto não vazio, trim). Array vazio é válido.
  if ('fidelidadeTexto' in p) {
    if (!Array.isArray(p.fidelidadeTexto)) return { erro: 'Texto da Fidelidade inválido — formato inesperado.' };
    const paragrafos = [];
    for (const par of p.fidelidadeTexto) {
      const texto = String(par || '').trim();
      if (!texto) return { erro: 'Nenhum parágrafo da Fidelidade pode ficar vazio.' };
      paragrafos.push(texto);
    }
    p.fidelidadeTexto = paragrafos;
  }

  return { patch: p };
}

/* REF-DELIVERY-FEE-02: FONTE UNICA de "a loja tem localizacao definida?" — reaproveitada pelo Admin
   (banner/indicador de saude da tela Taxa de Entrega) e pelo Checkout (decidir se calcula a distancia
   real ou cai no fallback "sem coordenadas"). Antes desta ref havia 2 checagens divergentes do MESMO
   estado (uma só olhava lojaLat, a outra olhava lat+lng) — nunca dar 2 respostas diferentes pra mesma
   pergunta. Exige AMBAS lat/lng numericas finitas (nunca uma sem a outra). */
export function localizacaoLojaConfigurada(info) {
  const i = info || {};
  return Number.isFinite(i.lojaLat) && Number.isFinite(i.lojaLng);
}
