require('dotenv').config();
const { Pool } = require('pg');

const YAHOO_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchBrapiDividends() {
  console.log('\n--- Brapi free tier (HGLG11, MXRF11) ---');
  const url = 'https://brapi.dev/api/v2/fii/dividends?symbols=HGLG11,MXRF11';
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  Brapi error ${res.status}`);
    return [];
  }
  const data = await res.json();
  console.log(`  Recebidos ${data.dividends?.length || 0} registros`);
  return data.dividends || [];
}

function parseBRDate(s) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

async function fetchStatusInvestDividends(ticker) {
  const statusPaths = ['fiinfras', 'fiis', 'acoes'];
  const dividends = [];

  for (const path of statusPaths) {
    const url = `https://statusinvest.com.br/${path}/${ticker.toLowerCase()}`;
    const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
    if (!res.ok) continue;

    const html = await res.text();
    const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    let found = false;

    for (const row of rows) {
      const tds = row.match(/<td[^>]*>(.*?)<\/td>/gs);
      if (!tds || tds.length < 4) continue;

      const typeRaw = tds[0].replace(/<[^>]+>/g, '').trim();
      const comDateRaw = tds[1].replace(/<[^>]+>/g, '').trim();
      const payDateRaw = tds[2].replace(/<[^>]+>/g, '').trim();
      const valueRaw = tds[3].replace(/<[^>]+>/g, '').trim();

      if (!comDateRaw.match(/\d{2}\/\d{2}\/\d{4}/)) continue;
      const value = parseFloat(valueRaw.replace(',', '.'));
      if (!value || value <= 0) continue;

      found = true;
      const type = typeRaw.toLowerCase().includes('amortiz') ? 'amortizacao' : 'rendimento';

      dividends.push({
        symbol: ticker,
        comDate: parseBRDate(comDateRaw),
        paymentDate: parseBRDate(payDateRaw),
        rate: value,
        type
      });
    }
    if (found) break;
  }

  return dividends;
}

async function fetchYahooDividends(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}.SA?range=5y&interval=1d&events=div`;
  const res = await fetch(url, { headers: { 'User-Agent': YAHOO_UA } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yahoo ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) {
    const err = data?.chart?.error;
    throw new Error(`Yahoo error: ${err?.code} - ${err?.description}`);
  }
  const dividends = result?.events?.dividends;
  if (!dividends) return [];

  const entries = [];
  for (const [tsStr, div] of Object.entries(dividends)) {
    const ts = parseInt(tsStr);
    const date = new Date(ts * 1000);
    const dateStr = date.toISOString().split('T')[0];
    entries.push({
      symbol: ticker,
      comDate: dateStr,
      paymentDate: null,
      rate: div.amount,
      type: 'rendimento'
    });
  }
  entries.sort((a, b) => a.comDate.localeCompare(b.comDate));
  return entries;
}

async function replaceTickerDividends(pool, assetId, dividends) {
  let inserted = 0;
  for (const div of dividends) {
    const comDate = div.comDate || null;
    const paymentDate = div.paymentDate || null;
    const grossAmount = parseFloat(div.rate) || 0;
    const divType = div.type || 'rendimento';

    if (!comDate && !paymentDate) continue;
    if (grossAmount <= 0) continue;

    const existing = await pool.query(
      'SELECT id FROM asset_dividends WHERE assetid = $1 AND comdate = $2 AND grossamount = $3',
      [assetId, comDate, grossAmount]
    );
    if (existing.rows.length > 0) continue;

    await pool.query(
      `INSERT INTO asset_dividends (assetid, comdate, paymentdate, grossamount, netamount, description, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [assetId, comDate, paymentDate || comDate, grossAmount, grossAmount, 'Dividendo', divType]
    );
    inserted++;
  }
  return inserted;
}

async function syncAllDividends(pool) {
  console.log(`[${new Date().toISOString()}] Sincronizando dividendos...`);
  const assets = await pool.query("SELECT id, ticker, name FROM b3_assets ORDER BY ticker");
  console.log(`Total de ativos: ${assets.rows.length}`);

  const assetMap = {};
  const allTickers = [];
  for (const a of assets.rows) {
    assetMap[a.ticker] = a.id;
    allTickers.push(a.ticker);
  }

  let totalInserted = 0;
  const errorTickers = [];

  // Brapi para FIIs especificos (HGLG11, MXRF11)
  const brapiDivs = await fetchBrapiDividends();
  if (brapiDivs.length > 0) {
    const mapped = brapiDivs.map(d => ({
      symbol: d.symbol,
      comDate: d.lastDatePrior ? d.lastDatePrior.split(' ')[0] : null,
      paymentDate: d.paymentDate ? d.paymentDate.split(' ')[0] : null,
      rate: d.rate,
      type: 'rendimento'
    }));
    for (const ticker of [...new Set(mapped.map(d => d.symbol))]) {
      const assetId = assetMap[ticker.toUpperCase()];
      if (!assetId) continue;
      const tickerDivs = mapped.filter(d => d.symbol === ticker);
      const inserted = await replaceTickerDividends(pool, assetId, tickerDivs);
      totalInserted += inserted;
      console.log(`  Brapi ${ticker}: ${tickerDivs.length} proventos (${inserted} novos)`);
    }
  }

  // Para cada ativo: tenta StatusInvest (datas corretas), fallback Yahoo (só data com)
  console.log('--- StatusInvest + Yahoo ---');
  const CONCURRENCY = 3;
  for (let i = 0; i < allTickers.length; i += CONCURRENCY) {
    const batch = allTickers.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(async ticker => {
      const siData = await fetchStatusInvestDividends(ticker);
      if (siData.length > 0) return { ticker, data: siData, source: 'StatusInvest' };
      const yData = await fetchYahooDividends(ticker);
      return { ticker, data: yData, source: 'Yahoo' };
    }));

    for (const result of results) {
      if (result.status !== 'fulfilled') {
        errorTickers.push('unknown');
        continue;
      }
      const { ticker, data, source } = result.value;
      if (data.length === 0) {
        errorTickers.push(ticker);
        continue;
      }

      const assetId = assetMap[ticker];
      if (!assetId) continue;

      await pool.query('DELETE FROM asset_dividends WHERE assetid = $1', [assetId]);
      const inserted = await replaceTickerDividends(pool, assetId, data);
      totalInserted += inserted;
      console.log(`  ${ticker} (${source}): ${data.length} proventos (${inserted} inseridos)`);
    }

    if (i + CONCURRENCY < allTickers.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log(`\nResumo: ${totalInserted} proventos salvos, ${errorTickers.length} ativos sem dados`);
  console.log(`[${new Date().toISOString()}] Sincronização concluída.\n`);
}

if (require.main === module) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db'
  });
  syncAllDividends(pool).then(() => pool.end()).catch(err => {
    console.error('Erro fatal:', err);
    pool.end();
    process.exit(1);
  });
}

module.exports = { syncAllDividends };
