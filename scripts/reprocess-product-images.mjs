/* scripts/reprocess-product-images.mjs — REF-PERF-01 · Onda E.
   Reprocessa as imagens de PRODUTO já publicadas no Supabase Storage (achado da auditoria: até 2,1MB
   por imagem, uploads antigos feitos antes da compressão client-side existir — ver Onda A,
   src/utils/imageCompression.js). NUNCA apaga/sobrescreve o arquivo original.

   Modo padrão = DRY RUN (só leitura: lista produtos com o client anônimo — mesmo que a loja usa pra
   exibir o catálogo — baixa cada imagem pela URL pública e mede o antes/depois; nada é gravado).

   Modo --apply escreve de verdade: sobe a versão redimensionada como ARQUIVO NOVO no bucket
   'products' e faz UPDATE em products.imagem_url pro novo arquivo (nunca DELETE do antigo — o arquivo
   original fica intocado no Storage, achável por quem tem a URL antiga, até uma limpeza manual futura
   e deliberada). Exige SUPABASE_SERVICE_ROLE_KEY (products.UPDATE é restrito a is_admin(), ver
   migrations/AUTH-01-step2-harden-rls.sql — a anon key nunca teria permissão) em .env.local (mesmo
   arquivo gitignored que já guarda segredos locais deste projeto — nunca commitado). Grava um log de
   reversão (JSON: id, url antiga, url nova) antes de cada UPDATE.

   Modo --rollback <arquivo.json> desfaz um --apply anterior: lê o log de reversão gerado por ele e
   devolve products.imagem_url pra url_antiga — SÓ quando o valor atual ainda for exatamente a
   url_nova que este script escreveu (guarda contra apagar uma edição mais recente feita por outro
   canal, ex.: o Admin trocando a imagem de novo depois do cutover). Não apaga o arquivo reprocessado
   do Storage (reversão de dado, não de arquivo — o novo webp fica órfão mas inofensivo).

   Uso:
     node scripts/reprocess-product-images.mjs                          # dry-run (leitura, seguro, sem SERVICE_ROLE_KEY)
     node scripts/reprocess-product-images.mjs --apply                  # grava de verdade (requer SERVICE_ROLE_KEY)
     node scripts/reprocess-product-images.mjs --apply --limit 2        # aplica só nas 2 primeiras (teste controlado)
     node scripts/reprocess-product-images.mjs --rollback <log.json>    # desfaz um --apply anterior (requer SERVICE_ROLE_KEY) */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const ARGS = process.argv.slice(2);
const APLICAR = ARGS.includes('--apply');
const ROLLBACK_IDX = ARGS.indexOf('--rollback');
const ROLLBACK_LOG = ROLLBACK_IDX >= 0 ? ARGS[ROLLBACK_IDX + 1] : null;
const LIMIT_IDX = ARGS.indexOf('--limit');
const LIMIT = LIMIT_IDX >= 0 ? Number(ARGS[LIMIT_IDX + 1]) : Infinity;

const MAX_DIMENSAO = 1280;   // mesmo alvo do ImageUploader (Onda A) — headroom p/ modal 480px x ~3x DPI
const QUALIDADE_WEBP = 80;

function lerEnv(caminho) {
  if (!existsSync(new URL(caminho, import.meta.url))) return {};
  const txt = readFileSync(new URL(caminho, import.meta.url), 'utf8');
  const out = {};
  for (const linha of txt.split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const envBase  = lerEnv('../.env');
const envLocal = lerEnv('../.env.local');
const SUPABASE_URL = envLocal.VITE_SUPABASE_URL || envBase.VITE_SUPABASE_URL;
const ANON_KEY      = envLocal.VITE_SUPABASE_KEY || envBase.VITE_SUPABASE_KEY;
const SERVICE_KEY   = envLocal.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('ERRO: VITE_SUPABASE_URL/VITE_SUPABASE_KEY ausentes (.env).');
  process.exit(2);
}
if ((APLICAR || ROLLBACK_LOG) && !SERVICE_KEY) {
  console.error('ERRO: --apply/--rollback exigem SUPABASE_SERVICE_ROLE_KEY em .env.local (products.UPDATE e is_admin()-only — a anon key nao grava). Sem a chave, rode sem essas flags (dry-run).');
  process.exit(2);
}

const anon  = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = (APLICAR || ROLLBACK_LOG) ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

const kb = n => (n / 1024).toFixed(1) + ' KB';
const BUCKET_MARK = '/storage/v1/object/public/products/';

async function rollback(logPath) {
  const entries = JSON.parse(readFileSync(logPath, 'utf8'));
  console.log(`ROLLBACK — ${entries.length} entrada(s) em ${logPath}.\n`);
  let ok = 0, pulados = 0, falhas = 0;
  for (const e of entries) {
    try {
      // guarda: só reverte se o valor atual ainda for o que ESTE apply escreveu (nunca pisa em
      // edição mais recente feita por outro canal, ex.: Admin trocando a imagem de novo).
      const { data: atual, error: selErr } = await admin.from('products').select('imagem_url').eq('id', e.id).single();
      if (selErr) throw new Error('select: ' + selErr.message);
      if (atual?.imagem_url !== e.url_nova) {
        console.log(`${String(e.id).padEnd(6)} PULADO (imagem_url mudou depois do apply — nao sobrescrito): ${e.nome || ''}`);
        pulados++; continue;
      }
      const { error: updErr } = await admin.from('products').update({ imagem_url: e.url_antiga }).eq('id', e.id);
      if (updErr) throw new Error('update: ' + updErr.message);
      console.log(`${String(e.id).padEnd(6)} revertido -> ${e.url_antiga}`);
      ok++;
    } catch (err) {
      falhas++;
      console.error(`${String(e.id).padEnd(6)} FALHOU: ${err.message}`);
    }
  }
  console.log(`\nRevertidos: ${ok}  |  pulados (mudaram depois): ${pulados}  |  falhas: ${falhas}`);
  console.log('(o arquivo .webp reprocessado NAO foi apagado do Storage — reversao so de dado)');
}

async function main() {
  if (ROLLBACK_LOG) { await rollback(ROLLBACK_LOG); return; }
  const { data: produtos, error } = await anon.from('products').select('id, nome, imagem_url').order('id');
  if (error) { console.error('ERRO ao listar produtos:', error.message); process.exit(1); }

  // '/reprocessed_' -> já passou por este script numa rodada anterior (ver upload em --apply, abaixo).
  // Sem este filtro, rodar de novo sem --limit reprocessaria o lote piloto uma 2a vez em cima da 1a
  // (URL já otimizada), inflando o log de reversão com um elo a mais sem necessidade.
  const alvo = (produtos ?? []).filter(p => p.imagem_url && p.imagem_url.includes(BUCKET_MARK) && !p.imagem_url.includes('/reprocessed_')).slice(0, LIMIT);
  console.log(`${APLICAR ? 'APLICANDO' : 'DRY-RUN'} — ${alvo.length} produto(s) com imagem no bucket 'products' (ja reprocessados nesta REF ficam de fora).\n`);

  const revertLog = [];
  let totalAntes = 0, totalDepois = 0, falhas = 0;

  for (const p of alvo) {
    try {
      const res = await fetch(p.imagem_url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const bufOriginal = Buffer.from(await res.arrayBuffer());
      const bufNovo = await sharp(bufOriginal)
        .resize({ width: MAX_DIMENSAO, height: MAX_DIMENSAO, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALIDADE_WEBP })
        .toBuffer();

      totalAntes += bufOriginal.length; totalDepois += bufNovo.length;
      const pct = (100 * (1 - bufNovo.length / bufOriginal.length)).toFixed(0);
      console.log(`${String(p.id).padEnd(6)} ${(p.nome || '').slice(0, 30).padEnd(32)} ${kb(bufOriginal.length).padStart(10)} -> ${kb(bufNovo.length).padStart(9)}  (-${pct}%)`);

      if (APLICAR) {
        const nome = `products/reprocessed_${p.id}_${Date.now()}.webp`;
        const { error: upErr } = await admin.storage.from('products').upload(nome, bufNovo, { cacheControl: '3600', upsert: false, contentType: 'image/webp' });
        if (upErr) throw new Error('upload: ' + upErr.message);
        const { data: urlData } = admin.storage.from('products').getPublicUrl(nome);
        const novaUrl = urlData?.publicUrl;
        const { error: updErr } = await admin.from('products').update({ imagem_url: novaUrl }).eq('id', p.id);
        if (updErr) throw new Error('update: ' + updErr.message);
        revertLog.push({ id: p.id, nome: p.nome, url_antiga: p.imagem_url, url_nova: novaUrl });
      }
    } catch (e) {
      falhas++;
      console.error(`${String(p.id).padEnd(6)} FALHOU: ${e.message}`);
    }
  }

  console.log(`\nTotal: ${kb(totalAntes)} -> ${kb(totalDepois)}  (-${(100 * (1 - totalDepois / (totalAntes || 1))).toFixed(0)}%)  |  falhas: ${falhas}`);

  if (APLICAR && revertLog.length) {
    const logPath = new URL(`../reprocess-product-images.revert.${Date.now()}.json`, import.meta.url);
    writeFileSync(logPath, JSON.stringify(revertLog, null, 2));
    console.log(`\nLog de reversao gravado em: ${logPath.pathname.replace(/^\/([A-Za-z]):/, '$1:')}`);
    console.log(`Para reverter: node scripts/reprocess-product-images.mjs --rollback "${logPath.pathname.replace(/^\/([A-Za-z]):/, '$1:')}"`);
  } else if (!APLICAR) {
    console.log('\n(dry-run — nada foi gravado no Storage nem no banco. Rode com --apply, com SUPABASE_SERVICE_ROLE_KEY em .env.local, pra aplicar de verdade.)');
  }
}

main();
