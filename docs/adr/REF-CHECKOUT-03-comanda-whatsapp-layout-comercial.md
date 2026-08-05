# ADR REF-CHECKOUT-03 — Layout comercial da mensagem de confirmação (WhatsApp)

**Status:** Implementado (frontend LIVE via Vercel; sem migration).
**Data:** 2026-08-05
**Escopo:** exclusivamente a apresentação da mensagem automática do WhatsApp introduzida em
[[REF-CHECKOUT-02]]. NÃO altera checkout, persistência, RPCs, regras de negócio, nem a comanda
impressa do Admin.

---

## 1. Contexto

A REF-CHECKOUT-02 unificou a mensagem do WhatsApp com a comanda do Admin (`buildComanda`/
`comandaTexto`), eliminando a duplicação de lógica. Mas o **conteúdo/layout** herdado era o de um
documento operacional interno (cabeçalho "ENCANTO DELIVERY" + "Marmitas • Açaí", número derivado do
UUID tipo `#604C0`, "Ref. cliente: #F5DDB1E0", "Taxa de entrega / ajuste") — apropriado para a cozinha,
mas confuso para o cliente que recebe a própria confirmação.

O dono anexou um mock (imagem) do layout desejado, inspirado em comandas de sistemas comerciais
(Anota AI, Goomer, Saipos): cabeçalho **PARA ENTREGA**/**RETIRADA** isolado, número de pedido limpo
("Pedido 12386"), sem códigos técnicos visíveis ao cliente.

### Achados da auditoria antes de implementar

- **Sem coluna sequencial no banco.** Introspecção read-only de `orders` (schema completo, sem alterar
  nada): só existem `id uuid` (`gen_random_uuid()`) e `created_at`. Não há `numero`/`sequencial`. Como
  alterar schema está fora do escopo ("não alterar persistência"), o número exibido ao cliente é uma
  **aproximação honesta**: epoch (segundos) de `created_at`, últimos 5 dígitos — sempre numérico, cresce
  com o tempo dentro de uma janela de uso, mas **reinicia o ciclo a cada ~27h** (100000s) e pode colidir
  entre pedidos de dias diferentes na mesma janela. **Gap documentado, trabalho futuro:** se o dono
  quiser um número verdadeiramente único e crescente para sempre, precisa de uma coluna/sequence própria
  no banco — decisão de schema que não coube nesta ref.
- **Imagem vs. texto do pedido divergiam em alguns detalhes** (ex.: a imagem mostra um horário de
  entrega calculado "23:05–23:25", o texto escrito pede o texto genérico "35 a 45 min"; a imagem mistura
  todo o endereço numa linha, o texto pede campos rotulados). Tratei o **texto escrito como a
  especificação** (mais recente e detalhado) e a **imagem como referência de hierarquia visual**
  (cabeçalho isolado, negrito nos títulos, blocos separados) — nunca como exigência caractere a
  caractere. Registrado aqui para não parecer inconsistência não-intencional.
- **"COBRAR DO CLIENTE"**: a REF-CHECKOUT-02 tinha *removido* essa linha do contexto do cliente
  ("instrução sem sentido para quem está enviando"). Reavaliando com o mock: quem **lê** a mensagem é a
  **loja** (o cliente só toca em Enviar) — a linha faz sentido para o atendente. Decisão revertida:
  mantida (com capitalização suavizada, `*Cobrar do cliente*`).

---

## 2. Decisão / arquitetura

### 2.1 Extensão aditiva do view-model (`comandaModel.js`)

Campos **novos**, nenhum removido/alterado — a comanda impressa do Admin (`comandaHTML` +
`comandaTextoInterna`) continua byte-a-byte idêntica (provado pelos golden tests, que rodam sem
nenhuma mudança nos casos "interna"):

- `numeroCurto` — 5 dígitos derivados do `created_at` (ver gap acima). `numero` (`#XXXXX` do UUID,
  usado pelo Admin) continua existindo, intocado.
- `tipoLabelCliente` — `'PARA ENTREGA'` / `'RETIRADA'`. `tipoLabel` (`'ENTREGA'`/`'RETIRADA'`, usado
  pela comanda impressa) continua existindo, intocado.
- `previsaoLabel` — `'Entrega prevista'` / `'Retirada prevista'`. `previsao` (o valor, "35 a 45 min")
  continua existindo, intocado.
- `loja.nomeComercial` — vem de `companyInfo.nomeCompleto` (campo **já administrável** pelo dono desde
  a REF-COMPANY-02/03, hoje "Encanto — Açaí & Marmitas"), reaproveitado em vez de hardcodar um nome
  novo. `loja.nome`/`loja.linha2`/`loja.nomeFooter` (usados pela comanda impressa) continuam existindo,
  intocados.

### 2.2 Dois renderers de texto (`comandaTexto.js`)

`comandaTexto(vm, opts)` decide entre duas funções internas sobre o **mesmo** view-model:

- `comandaTextoInterna` — o código **exato** de antes da REF-CHECKOUT-02/03 (zero mudança), usado por
  padrão (Admin).
- `comandaTextoCliente` (nova) — o layout comercial:

```
*PARA ENTREGA*                    ← tipoLabelCliente, sozinho no topo

04/08/2026 13:11                  ← criadoEm (sem a vírgula do locale pt-BR)
Entrega prevista: 35 a 45 min      ← previsaoLabel + previsao
Encanto — Açaí & Marmitas          ← loja.nomeComercial

*Pedido 12386*                    ← numeroCurto (nunca #/hash/UUID)

*ITENS*
1x Marmita Grande
  Adicionais: ...
  OBS: ...

*CLIENTE*
Nome:
Jose
Telefone:
(47) 99602-8822
Entrega:                          ← só se NÃO for retirada
Rua ..., 955
Bairro — Cidade
Ponto de referência: ...

*PAGAMENTO*
Forma de Pagamento:
Dinheiro

*Cobrar do cliente*

Subtotal: R$ 30,00
Desconto: R$ 0,00                 ← só quando total < soma dos itens (SEM taxa — não calculada ainda)
*TOTAL: R$ 30,00*
Troco para: R$ 50,00              ← ou "Troco: Não precisa" (SEMPRE aparece, nunca omite a linha)

Encanto — Açaí & Marmitas
```

Removido do contexto cliente: "Ref. cliente" (código técnico), "ENCANTO DELIVERY"/"Marmitas • Açaí"
(jargão de documento interno no topo), "Obrigado pela preferência!" (rodapé simplificado).

### 2.3 Endereço estruturado chega até a mensagem do cliente

O CheckoutPage já tinha, no domínio Address (`useAddress()`), o objeto estruturado
`{ rua, numero, complemento, bairro, cidade, estado, cep, referencia }` — o **mesmo shape** que
`DS.getPedidoEndereco` devolve para o Admin. A REF-CHECKOUT-02 descartava esse dado (só repassava a
string livre `order.address`). Agora `buildOrderConfirmationMessage` aceita `opts.enderecoEstruturado`
e o `CheckoutPage.submit` repassa o objeto direto (retirada: `null`) — **sem nenhuma query nova**,
reaproveitando 100% `enderecoEstruturadoEmLinhas` (mesma função que já formatava isso para o Admin).
Quando ausente (endereço sem detalhamento), cai no fallback de texto livre de sempre.

### 2.4 O que NÃO mudou

- Persistência, RPCs, `create_order`, regras de negócio, comanda impressa/HTML do Admin, fluxo de
  auto-abertura + contingência da REF-CHECKOUT-02 — todos intocados.

---

## 3. Testes

- `tests/comanda.golden.mjs` — ~20 casos novos: `numeroCurto` (5 dígitos, determinístico, muda com
  `created_at`), `tipoLabelCliente`/`previsaoLabel`/`loja.nomeComercial` (aditivos), layout completo do
  `comandaTextoCliente` (cabeçalho isolado, sem jargão interno, "Cobrar do cliente" mantido, troco
  sempre explícito, sem taxa/só desconto, endereço estruturado sob "Entrega:", rodapé simplificado);
  prova de que `comandaTextoInterna`/`comandaHTML` (Admin) continuam 100% intocados.
- `tests/checkout.golden.mjs` (§C) — atualizado para o novo formato; novo caso (C7) prova que o
  endereço estruturado chega até a mensagem.
- `e2e/tests/checkout/checkout-whatsapp.spec.js` — atualizado: verifica cabeçalho `*RETIRADA*`,
  `Pedido \d{5}` (regex, sem hash), `*Cobrar do cliente*`, `Troco: Não precisa`; suíte completa (7/7
  checkout, 113/113 e2e geral, `test:domain` 34/34, build) verde.

Relaciona: [[REF-CHECKOUT-02]] (fluxo de auto-abertura + camada compartilhada, base desta ref),
[[REF-ORDER-01-fluxo-pedidos-profissional]] (gaps honestos de troco/taxa, mesmo padrão aplicado aqui
ao número do pedido), [[REF-COMPANY-02]]/[[REF-COMPANY-03]] (`nomeCompleto` administrável, reaproveitado
em vez de hardcode).
