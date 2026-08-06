# ADR REF-DELIVERY-FEE-02 — Blindagem operacional da localização da loja

**Status:** Implementada no código; 1 migration nova pendente de aplicação manual no Supabase (produção)
— nunca aplicada no projeto de E2E também (achado da auditoria, ver §4).
**Depende de:** REF-DELIVERY-FEE-01 (taxa por distância), REF-COMPANY-01/02/03 (`company_info`).
**Push/deploy:** não realizados nesta rodada — implementação parada para aprovação, por pedido explícito.

## 1. Contexto

A auditoria pós-implantação da REF-DELIVERY-FEE-01 identificou um bloqueante operacional real: sem
`company_info.lojaLat`/`lojaLng` configurados, **toda** entrega cai no fallback "sem coordenadas" e sai
com taxa **R$ 0,00** — o checkout nunca é bloqueado (decisão deliberada da REF-DELIVERY-FEE-01), mas a
cobrança real simplesmente não acontece, silenciosamente. A tela Admin já existia (`AdminTaxaEntrega.jsx`,
bloco "📍 Localização da loja"), mas o aviso de estado era uma legenda cinza pequena, fácil de não notar,
e não havia nada no carregamento da tela que chamasse atenção para o problema.

### Diagnóstico do fluxo existente (quem grava / quem lê / quem valida / onde falta)

- **Grava:** um único ponto em todo o código — `BlocoLocalizacao.salvar()` em `AdminTaxaEntrega.jsx`,
  disparado ao arrastar/clicar o pino no mapa e clicar "Salvar localização"; chama
  `salvarCompanyInfo({ lojaLat, lojaLng })` (`services/company/companyInfo.js`), que faz PATCH via RPC
  `set_company_info`.
- **Lê:** `useCompanyInfo()` (hook global, cache em memória + `get_company_info()`), consumido por
  `AdminTaxaEntrega.jsx` (mapa/status) e por `CheckoutPage.jsx` (cálculo de distância real).
- **Valida:**
  - Cliente: `companyInfoRules.validarPatchCompanyInfo` já validava lat/lng (finito, -90..90/-180..180,
    `null` permitido para limpar o pino) — préexistente da REF-DELIVERY-FEE-01, coberto por
    `tests/company-info.golden.mjs`.
  - **Servidor: NÃO validava.** `set_company_info` (RPC genérica de patch) valida `nomeCurto`/
    `nomeCompleto`/`telefone`/`whatsapp`/`email`/`whatsappFloatEnabled` desde a REF-COMPANY-01/02, mas
    `lojaLat`/`lojaLng` nunca ganharam bloco de validação equivalente — documentado explicitamente no
    comentário de `companyInfoRules.js` ("validação NUMÉRICA fica só no cliente"). Isso é seguro
    enquanto a única origem do valor for o clique/arrasto no mapa Leaflet (sempre número real), mas
    `set_company_info` é uma RPC pública para qualquer sessão `authenticated` — uma chamada direta (fora
    do React) podia gravar `{"lojaLat":"lixo"}` ou `{"lojaLat":999}` sem o servidor reclamar.
  - **Onde falta configurar:** a única forma de o Admin nunca configurar é simplesmente nunca ter
    aberto a aba "Taxa de Entrega" e clicado "Salvar localização" — não existe (e nunca existiu) um
    botão de "limpar pino" na UI, então depois da 1ª gravação bem-sucedida o estado não regride sozinho.
- **Achado colateral (bug real, não cosmético):** a legenda de status em `BlocoLocalizacao` só checava
  `Number.isFinite(info.lojaLat)` (ignorava `lojaLng`); `CheckoutPage.jsx` já checava os dois. Duas
  implementações da mesma pergunta ("a loja tem posição?") podiam divergir.

## 2. Decisão / arquitetura

Sem tabela nova, sem RPC nova, sem serviço paralelo — 100% dentro de `company_info` e do fluxo de mapa
já existente (Leaflet/OSM, `address/services/mapService.js`), por instrução explícita do dono.

### 2.1 Fonte única — `localizacaoLojaConfigurada(info)`

Nova função pura em `services/company/companyInfoRules.js`: `Number.isFinite(lat) && Number.isFinite(lng)`.
Substitui as 2 checagens divergentes (`AdminTaxaEntrega.jsx` e `CheckoutPage.jsx` passam a importar a
mesma função) — impossível voltar a divergir sem quebrar o guard estrutural novo (§4).

### 2.2 Blindagem visual do Admin (`AdminTaxaEntrega.jsx`)

- `StatusLocalizacaoLoja`: banner destacado (fundo/borda coloridos, ✅/❌, `data-testid` dedicado) no
  topo da tela, visível **antes de qualquer interação** — cobre ao mesmo tempo "diagnóstico no
  carregamento" e "indicador de saúde" pedidos na auditoria original (deliberadamente uma peça só: 2
  indicadores separados do mesmo estado é exatamente o tipo de duplicação que causou o bug do §1).
  Mensagem explícita: "TODOS os pedidos de entrega saem com taxa R$ 0,00" quando não configurado.
- Legenda de `BlocoLocalizacao` corrigida para usar a mesma função (fecha o bug do lat-only).
- Botão novo **"🎯 Centralizar no ponto salvo"**: descarta qualquer arrasto pendente e remonta o mapa na
  posição oficial (ou no centro padrão da cidade, se ainda não configurada) — via um contador de reset
  que participa da `key` do componente do mapa (mesmo mecanismo de remontagem já usado pelo `coordKey`
  original), sem precisar expor a instância do marcador Leaflet (que `mapService.js` não expõe hoje, e
  não foi alterado — fora do escopo autorizado).

### 2.3 Validação de salvamento — fechando a lacuna do servidor

Migration nova `REF-DELIVERY-FEE-02-loja-coords-validacao.sql`: `CREATE OR REPLACE` de `set_company_info`
(mesmo padrão de toda evolução anterior desta RPC — REF-COMPANY-02 é a base copiada), acrescentando 2
blocos de validação que espelham exatamente a regra já validada no cliente: presente precisa ser
`jsonb_typeof = 'number'` (nunca string/bool/array — a única forma de "impedir NaN" em SQL, já que JSON
não tem NaN) dentro de -90..90 (lat) / -180..180 (lng); `null` continua válido (limpa o pino). Rollback
em arquivo separado, restaurando o corpo exato anterior. `get_company_info()` não muda.

## 3. O que NÃO mudou

- Arquitetura de `company_info` (chave única JSON em `settings`, merge raso no servidor).
- Fallback existente da REF-DELIVERY-FEE-01 (`sem_coordenadas` → taxa R$0, checkout nunca bloqueia).
- Fluxo do mapa (`carregarLeaflet`/`criarMapa`/`destruirMapa`, `address/services/mapService.js`) —
  zero linha alterada.
- Contrato de `salvarCompanyInfo`/`useCompanyInfo` — nenhum consumidor existente quebrou.

## 4. Achado adicional da auditoria (gap de ambiente, não desta ref)

Validando o round-trip real via E2E contra o projeto Supabase dedicado (`encanto-e2e`), confirmou-se via
REST direto (`PGRST202`) que **nem `get_company_info` nem `set_company_info` existem nesse projeto** — as
migrations REF-COMPANY-01/02 nunca foram aplicadas lá (só em produção). Não é uma regressão desta ref:
não havia, antes dela, nenhum spec de `AdminEmpresa.jsx` cobrindo escrita real pelo mesmo motivo. O teste
novo (§5) cobre os dois desfechos possíveis e documenta o gap em vez de escondê-lo (mesmo espírito do
token Mapbox pendente em REF-ADDRESS-02). Recomendação: aplicar REF-COMPANY-01, REF-COMPANY-02 e esta
REF-DELIVERY-FEE-02 no projeto de E2E para fechar a lacuna.

## 5. Testes

- `tests/company-info.golden.mjs`: 7 casos novos de `localizacaoLojaConfigurada` (sem coordenadas, com
  coordenadas válidas, `0,0` não confundido com ausente, só lat/só lng — estado defendido mesmo sendo
  impossível pela UI, NaN/string, `info` ausente).
- `tests/deliveryFee-admin.guard.mjs`: 5 checagens estruturais novas — Admin e Checkout importam e usam
  a mesma `localizacaoLojaConfigurada` (nenhum dos dois reimplementa `Number.isFinite` local), banner e
  botão "Centralizar" existem no componente.
- `e2e/tests/admin/admin-taxa-entrega.spec.js`: novo `describe` (`mode:'serial'`, `company_info` é
  GLOBAL — mesma disciplina de `admin-status.spec.js`/`admin-delivery-eta.spec.js`), com captura e
  restauração de baseline via `supabaseAdmin()`. Cobre, **rodado de verdade contra o Supabase de E2E**:
  banner ❌ ao abrir sem coordenadas, clique no mapa habilita "Salvar localização", "Centralizar" descarta
  o arrasto sem gravar nada, e (condicionalmente ao gap do §4) o round-trip completo de gravação +
  persistência real + sobrevivência a um reload. Confirmado visualmente por screenshot os dois estados do
  banner (✅ via mock de rede, dado o gap do §4; ❌ contra o dado real).
- `test:domain` (37 scripts, incluindo os dois arquivos acima) e `npm run build` verdes.

## 6. Impacto e próximos passos

Depois de o dono aplicar a migration e configurar a localização (ou confirmar que já está configurada),
não existe mais nenhum estado da tela Admin onde "parece que a taxa está funcionando, mas na verdade toda
entrega é grátis" — o banner é a primeira coisa visível ao abrir a aba, sempre reflete o estado real
(fonte única testada), e nunca finge sucesso antes do servidor confirmar (mesmo padrão TRUTHFUL de todo o
domínio). `v_order_reconciliation` continuar sem descontar `delivery_fee`/`maquininha_fee` (limitação já
registrada na REF-DELIVERY-FEE-01) permanece fora do escopo desta ref.
