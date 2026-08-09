/* constants/storeInfo.js — informacoes institucionais da loja AINDA ESTATICAS (LOGIN-ARCH-02).
   REF-COMPANY-01: nome/telefone/whatsapp/e-mail MIGRARAM para company_info (Supabase, administravel
   pelo Admin) — ver hooks/useCompanyInfo.js. REF-COMPANY-03 (Central de Configuração da Empresa):
   SOBRE_TEXTO, endereco (institucional) e social TAMBEM migraram para company_info — ver
   services/company/companyInfoRules.js. REF-SAAS-01 · Onda 6.2: TERMOS_SECOES/FIDELIDADE_TEXTO
   MIGRARAM para company_info.termosSecoes/fidelidadeTexto (mesma migracao) — ver
   components/menu/TermosScreen.jsx e FidelidadeScreen.jsx. REF-SAAS-01 · Onda 6.3: `cidade` REMOVIDA
   (era codigo morto — zero consumidor; o cabecalho da loja sempre teve o literal "Timbó" hardcoded
   direto em StoreApp.jsx, nunca leu esta chave — corrigido para ler company_info.cidade, endereco
   institucional, ja por loja). `retirada` abaixo e uma coisa DIFERENTE (endereco de RETIRADA
   operacional do checkout) e continua aqui, intocado — nunca cruzar com o endereco institucional.
   Camada de constantes: sem imports (regra D2 do test:deps trivialmente satisfeita). */
export const STORE_INFO = {
  /* REF-CHECKOUT-ADDRESS-01: endereco de RETIRADA na loja (fonte unica — usado no header e no checkout).
     Entidade INDEPENDENTE do endereco institucional (company_info.rua/numero/... — REF-COMPANY-03). */
  retirada: 'Rua João Schley, 77 Casa 02',
};
