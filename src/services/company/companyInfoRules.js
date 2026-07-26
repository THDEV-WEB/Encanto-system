/* services/company/companyInfoRules.js — REF-COMPANY-01.
   Regras PURAS dos dados institucionais da empresa: defaults, formatacao de telefone e validacao de
   patch. ZERO IO (sem Supabase, sem window/localStorage) — import seguro em Node puro
   (tests/company-info.golden.mjs). Espelha a separacao pura/IO ja usada em
   services/businessHours/businessHours.js (puro) vs services/businessHours/override.js (IO): o modulo
   com efeito (companyInfo.js) importa daqui; nunca o contrario. */
import { normalizePhoneBR } from '../notifications/WhatsAppService.js';

export const DEFAULT_COMPANY_INFO = {
  nome: 'Encanto — Açaí & Marmitas',
  telefone: '5547992722920',
  whatsapp: '5547992722920',
  email: 'contato@encantoacai.com.br',
  whatsappFloatEnabled: true,
};

const emailValido = (e) => /.+@.+\..+/.test((e || '').trim());

/* Formata E.164 BR ('55DDNNNNNNNNN') para exibicao humana '(DD) 9NNNN-NNNN'. Pura, sem estado. */
export function formatarTelefoneBR(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  const local = (d.length > 11 && d.startsWith('55')) ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits ? String(digits) : '';
}

/* Valida/normaliza um PATCH no CLIENTE (evita round-trip obvio); a validacao que vale sempre e a do
   servidor (set_company_info revalida tudo, e e a UNICA fonte de verdade). Telefone/whatsapp reusam o
   MESMO normalizador do resto do projeto (normalizePhoneBR) — nao inventa uma 4a regra de telefone.
   Retorna { patch } normalizado ou { erro }. */
export function validarPatchCompanyInfo(patch) {
  const p = { ...patch };
  if ('nome' in p) {
    const n = String(p.nome || '').trim();
    if (n.length < 2) return { erro: 'Informe o nome da empresa (mínimo 2 caracteres).' };
    p.nome = n;
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
  return { patch: p };
}
