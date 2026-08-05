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
   "sem coordenadas", nunca cobra errado, ver deliveryFeeRules.montarResumoFinanceiro). */
import { normalizePhoneBR } from '../notifications/WhatsAppService.js';

export const DEFAULT_COMPANY_INFO = {
  // Identidade
  nomeCurto: 'Encanto',
  nomeCompleto: 'Encanto — Açaí & Marmitas',
  // Contato
  telefone: '5547992722920',
  whatsapp: '5547992722920',
  email: 'contato@encantoacai.com.br',
  whatsappFloatEnabled: true,
  // Sobre
  sobre: 'O Encanto nasceu para levar açaí cremoso, marmitas caseiras e sabores de verdade até a sua casa, em Timbó e região.\n\nTrabalhamos com ingredientes selecionados, montagem na hora e entrega rápida — do jeitinho que você gosta.\n\nNosso compromisso é simples: um Encanto de sabores em cada pedido.',
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
  if ('telefone' in p) {
    const t = normalizePhoneBR(p.telefone);
    if (t.length < 12 || t.length > 13) return { erro: 'Telefone inválido. Informe DDD + número.' };
    p.telefone = t;
  }
  if ('whatsapp' in p) {
    const w = normalizePhoneBR(p.whatsapp);
    if (w.length < 12 || w.length > 13) return { erro: 'WhatsApp inválido. Informe DDD + número.' };
    p.whatsapp = w;
  }
  if ('email' in p) {
    const e = String(p.email || '').trim().toLowerCase();
    if (!emailValido(e)) return { erro: 'Digite um e-mail válido.' };
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

  return { patch: p };
}
