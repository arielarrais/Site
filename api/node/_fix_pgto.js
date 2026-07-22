require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db'
});

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FII_DELAY_MS = 1500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseBRDate(s) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function fmtBR(d) {
  return d ? d.split('-').reverse().join('/') : '';
}

async function fetchStatusInvestAcoes(ticker) {
  const url = `https://statusinvest.com.br/acoes/${ticker.toLowerCase()}`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
  if (!res.ok) return [];
  const html = await res.text();
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const dividends = [];
  for (const row of rows) {
    const tds = row.match(/<td[^>]*>(.*?)<\/td>/gs);
    if (!tds || tds.length < 4) continue;
    const comRaw = tds[1].replace(/<[^>]+>/g, '').trim();
    const payRaw = tds[2].replace(/<[^>]+>/g, '').trim();
    const valRaw = tds[3].replace(/<[^>]+>/g, '').trim();
    if (!comRaw.match(/\d{2}\/\d{2}\/\d{4}/)) continue;
    const val = parseFloat(valRaw.replace(',', '.'));
    if (!val || val <= 0) continue;
    dividends.push({ comDate: parseBRDate(comRaw), paymentDate: parseBRDate(payRaw), grossAmount: val });
  }
  return dividends;
}

async function fetchInvestidor10Fiis(ticker) {
  const url = `https://investidor10.com.br/fiis/${ticker.toLowerCase()}/`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
  if (!res.ok) return [];
  const html = await res.text();
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const headers = table.match(/<th[^>]*>(.*?)<\/th>/gi);
    if (!headers || !headers.join('').includes('data com')) continue;

    const rows = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    const dividends = [];
    for (let ri = 1; ri < rows.length; ri++) {
      const tds = rows[ri].match(/<td[^>]*>(.*?)<\/td>/gs);
      if (!tds || tds.length < 4) continue;
      const comRaw = tds[1].replace(/<[^>]+>/g, '').trim();
      const payRaw = tds[2].replace(/<[^>]+>/g, '').trim();
      const valRaw = tds[3].replace(/<[^>]+>/g, '').trim();
      if (!comRaw.match(/\d{2}\/\d{2}\/\d{4}/)) continue;
      const val = parseFloat(valRaw.replace(',', '.'));
      if (!val || val <= 0) continue;
      dividends.push({ comDate: parseBRDate(comRaw), paymentDate: parseBRDate(payRaw), grossAmount: val });
    }
    if (dividends.length > 0) return dividends;
  }
  return [];
}

async function fixAcoes(dividends, ticker) {
  const siData = await fetchStatusInvestAcoes(ticker);
  if (siData.length === 0) return { atualizados: 0, ignorados: dividends.length };

  const pgtoMap = {};
  for (const d of siData) {
    if (d.comDate && d.paymentDate && d.paymentDate !== d.comDate) {
      pgtoMap[d.comDate] = d.paymentDate;
    }
  }

  let atualizados = 0;
  let ignorados = 0;
  for (const div of dividends) {
    const novaPgto = pgtoMap[div.comdate];
    if (!novaPgto) { ignorados++; continue; }
    await pool.query('UPDATE asset_dividends SET paymentdate = $1 WHERE id = $2', [novaPgto, div.id]);
    console.log(`  ${ticker} COM ${div.comdate}: ${div.paymentdate} -> ${novaPgto}`);
    atualizados++;
  }
  return { atualizados, ignorados };
}

function daysBetween(a, b) {
  return Math.abs((new Date(a) - new Date(b)) / 86400000);
}

async function fixFiis(dividends, ticker) {
  const i10Data = await fetchInvestidor10Fiis(ticker);
  if (i10Data.length === 0) return { atualizados: 0, ignorados: dividends.length };

  // Yahoo retorna data de pagamento como "date" (armazenado como comdate no DB)
  // Match por: grossAmount proximo + paymentDate do I10 proximo da comdate do DB
  let atualizados = 0;
  let ignorados = 0;
  for (const div of dividends) {
    const match = i10Data
      .filter(d => d.paymentDate !== d.comDate && Math.abs(d.grossAmount - div.grossamount) < 0.01)
      .sort((a, b) => daysBetween(a.paymentDate, div.comdate) - daysBetween(b.paymentDate, div.comdate))[0];
    if (!match || daysBetween(match.paymentDate, div.comdate) > 15) { ignorados++; continue; }
    await pool.query('UPDATE asset_dividends SET paymentdate = $1 WHERE id = $2', [match.paymentDate, div.id]);
    console.log(`  ${ticker} COM ${div.comdate} R$${div.grossamount}: ${div.paymentdate} -> ${match.paymentDate}`);
    atualizados++;
  }
  return { atualizados, ignorados };
}

async function fixPaymentDates() {
  console.log(`[${new Date().toISOString()}] Iniciando correcao das datas pgto...\n`);

  const result = await pool.query(`
    SELECT d.id, d.assetid, d.comdate, d.paymentdate, d.grossamount, a.ticker, a.assettype
    FROM asset_dividends d
    JOIN b3_assets a ON a.id = d.assetid
    WHERE d.paymentdate = d.comdate
    ORDER BY a.ticker, d.comdate
  `);

  console.log(`Total de dividendos com pgto = COM: ${result.rows.length}\n`);

  const byTicker = {};
  for (const row of result.rows) {
    if (!byTicker[row.ticker]) byTicker[row.ticker] = { rows: [], assettype: row.assettype };
    byTicker[row.ticker].rows.push(row);
  }

  let totalAtualizados = 0;
  let totalIgnorados = 0;

  for (const [ticker, { rows: dividends, assettype }] of Object.entries(byTicker)) {
    const fn = assettype === 'acao' ? fixAcoes : fixFiis;
    const fonte = assettype === 'acao' ? 'StatusInvest' : 'Investidor10';
    console.log(`Buscando ${ticker} (${assettype}) no ${fonte}...`);
    const r = await fn(dividends, ticker);
    totalAtualizados += r.atualizados;
    totalIgnorados += r.ignorados;
    console.log(`  -> ${r.atualizados} atualizados, ${r.ignorados} ignorados\n`);
    if (assettype !== 'acao') await sleep(FII_DELAY_MS);
  }

  console.log(`\nResumo final:`);
  console.log(`  Atualizados: ${totalAtualizados}`);
  console.log(`  Ignorados:   ${totalIgnorados}`);
  console.log(`[${new Date().toISOString()}] Concluido.`);
}

fixPaymentDates().then(() => pool.end()).catch(err => {
  console.error('Erro fatal:', err);
  pool.end();
  process.exit(1);
});
