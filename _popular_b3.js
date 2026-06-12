const https = require('https');
const { Client } = require('pg');

const PG = 'postgresql://postgres:wdYjjTAKwyGOopdARgVrMNbrZRJrZQPv@yamanote.proxy.rlwy.net:40845/railway';

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Parse error: ' + e.message + ' | data: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // 1. Buscar todos os tickers disponiveis na Brapi
  console.log('Buscando tickers na Brapi...');
  const available = await fetchJSON('https://brapi.dev/api/available');
  const allTickers = (available.stocks || []).map(t => t.toUpperCase().trim()).filter(Boolean);
  console.log(`Total tickers encontrados: ${allTickers.length}`);

  // 2. Conectar no PG
  const pg = new Client({ connectionString: PG });
  await pg.connect();
  console.log('Conectado ao PostgreSQL de produção.');

  // 3. Pegar tickers ja existentes
  const existing = await pg.query('SELECT ticker FROM b3_assets');
  const existingSet = new Set(existing.rows.map(r => r.ticker.toUpperCase()));
  const novos = allTickers.filter(t => !existingSet.has(t));
  console.log(`Novos tickers para inserir: ${novos.length}`);

  // 4. Inserir em batch de 100
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < novos.length; i += BATCH) {
    const batch = novos.slice(i, i + BATCH);
    const values = batch.map((t, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`).join(',');
    const flatParams = [];
    for (const t of batch) {
      const tipo = t.endsWith('11') || t.endsWith('11F') ? 'fii' : 'acao';
      flatParams.push(t, null, null, tipo);
    }
    await pg.query(
      `INSERT INTO b3_assets (ticker, name, longname, assettype) VALUES ${values} ON CONFLICT (ticker) DO NOTHING`,
      flatParams
    );
    inserted += batch.length;
    console.log(`  ${inserted}/${novos.length} inseridos...`);
    await sleep(200);
  }

  console.log(`Inserção concluida. Total: ${inserted}`);
  await pg.end();
}

main().catch(err => { console.error('Erro:', err); process.exit(1); });
