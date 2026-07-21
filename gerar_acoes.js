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

async function getAllStocks() {
  const all = [];
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

    const stocks = json.stocks.filter(s => {
      const subType = s.subType || '';
      return subType === 'stock';
    });
    all.push(...stocks);

    if (json.stocks.length < size) break;
    page++;
  }

  return all;
}

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Buscando todas as acoes da B3 via BRAPI...\n');
  const stocks = await getAllStocks();
  console.log(`\n\nTotal de acoes encontradas: ${stocks.length}\n`);

  stocks.sort((a, b) => (a.stock || '').localeCompare(b.stock || ''));

  const rows = stocks.map(s => {
    const ticker = s.stock || '';
    const name = (s.name || '').replace(/"/g, '""');
    const close = s.close || '';
    const sector = (s.sector || '').replace(/"/g, '""');
    const subsector = (s.subsector || '').replace(/"/g, '""');
    return `"${ticker}";"${name}";${close};"${sector}";"${subsector}"`;
  });

  const header = '"Ticker";"Nome";"Preco Atual";"Setor";"Subsetor"';
  const csv = [header, ...rows].join('\n');

  const csvPath = path.join(OUTPUT_DIR, 'acoes_b3.csv');
  fs.writeFileSync(csvPath, '\uFEFF' + csv, 'utf-8');
  console.log(`CSV salvo em: ${csvPath}`);
  console.log(`Total de linhas: ${rows.length}`);

  try {
    const XLSX = require('xlsx');
    const data = stocks.map(s => ({
      'Ticker': s.stock || '',
      'Nome': s.name || '',
      'Preco Atual': s.close || '',
      'Setor': s.sector || '',
      'Subsetor': s.subsector || ''
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Acoes');
    const xlsxPath = path.join(OUTPUT_DIR, 'acoes_b3.xlsx');
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
