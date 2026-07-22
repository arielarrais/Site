require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
const OUTPUT_DIR = path.join(__dirname, 'Tickers');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

async function getAllFIIs() {
  const allFiis = [];
  let page = 1;
  const size = 200;

  while (true) {
    const url = `https://brapi.dev/api/quote/list?page=${page}&size=${size}&sortBy=name&sortOrder=asc&token=${BRAPI_TOKEN}`;
    process.stdout.write(`\rBuscando pagina ${page}...`);

    const res = await fetch(url);
    if (res.status !== 200) {
      console.error(`\nErro HTTP ${res.status} na pagina ${page}`);
      break;
    }

    const json = JSON.parse(res.data);
    if (!json.stocks || json.stocks.length === 0) break;

    const fiis = json.stocks.filter(s => {
      const ticker = s.stock || s.symbol || '';
      const subType = s.subType || '';
      return ticker.endsWith('11') && !ticker.endsWith('11F') && (subType === 'fii' || subType === 'fi-agro' || subType === 'fi-infra' || subType === 'fip');
    });
    allFiis.push(...fiis);

    if (json.stocks.length < size) break;
    page++;
  }

  return allFiis;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Buscando todos os FIIs da B3 via BRAPI...\n');
  const fiis = await getAllFIIs();
  console.log(`\n\nTotal de FIIs encontrados: ${fiis.length}\n`);

  fiis.sort((a, b) => (a.stock || a.symbol || '').localeCompare(b.stock || b.symbol || ''));

  const rows = fiis.map(f => {
    const ticker = (f.stock || f.symbol || '');
    const name = (f.name || '').replace(/"/g, '""');
    const close = f.close || '';
    const subsector = (f.subsector || '').replace(/"/g, '""');
    return `"${ticker}";"${name}";${close};"${subsector}"`;
  });

  const header = '"Ticker";"Nome";"Preco Atual";"Setor"';
  const csv = [header, ...rows].join('\n');

  const csvPath = path.join(OUTPUT_DIR, 'fiis_b3.csv');
  fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf-8');
  console.log(`CSV salvo em: ${csvPath}`);
  console.log(`Total de linhas: ${rows.length}`);

  try {
    const XLSX = require('xlsx');
    const data = fiis.map(f => ({
      'Ticker': (f.stock || f.symbol || ''),
      'Nome': f.name || '',
      'Preco Atual': f.close || '',
      'Setor': f.subsector || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FIIs');
    const xlsxPath = path.join(OUTPUT_DIR, 'fiis_b3.xlsx');
    XLSX.writeFile(wb, xlsxPath);
    console.log(`Excel salvo em: ${xlsxPath}`);
  } catch (err) {
    console.log('XLSX nao disponivel, apenas CSV foi gerado.');
  }

  console.log('\nConcluido!');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
