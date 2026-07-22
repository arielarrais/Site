require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db'
});

const RULES = [
  { keywords: ['shopping', 'mall', 'shoppings', 'shp'], type: 'shopping' },
  { keywords: ['logistic', 'log', 'logística', 'logistica', 'logistico'], type: 'logistica' },
  { keywords: ['lajes corporativas', 'lajes', 'office', 'offices', 'corporativos', 'edificios corporativos', 'torre', 'torres', 'edif'], type: 'lajes corporativas' },
  { keywords: ['residencial', 'residenciais', 'residential', 'habita'], type: 'residencial' },
  { keywords: ['hotel', 'hotéis', 'hoteis', 'motel'], type: 'hotel' },
  { keywords: ['educacional', 'educacao', 'educação', 'escola', 'educac', 'mint educ'], type: 'educacao' },
  { keywords: ['hospital', 'saude', 'saúde', 'hospitalar', 'unimed', 'nsra', 'crianca'], type: 'saude' },
  { keywords: ['desenvolvimento', 'desenv', 'development', 'desenvolv'], type: 'desenvolvimento' },
  { keywords: ['agro', 'fiagro', 'agricola', 'agrícola', 'terras', 'lavoura'], type: 'agro' },
  { keywords: ['energia', 'energias', 'energi'], type: 'energia' },
  { keywords: ['fof', 'fundos', 'fund', 'fundo de fundos', 'fund of funds', 'fo'], type: 'fof' },
  { keywords: ['papel', 'papeis', 'papéis', 'securities', 'credito', 'crédito', 'recebiveis', 'recebíveis', 'receb', 'cri', 'titulos', 'títulos', 'high yield', 'hybrid'], type: 'papel' },
  { keywords: ['varejo', 'retail', 'lojas'], type: 'varejo' },
  { keywords: ['multiestrategia', 'multi estratégia', 'multi-estrategia', 'mult', 'multi', 'hibrido', 'híbrido', 'multigestão'], type: 'hibrido' },
  { keywords: ['agencias', 'agências', 'agenc'], type: 'agencias' },
  { keywords: ['cemiterio', 'cemitério', 'cemiterios', 'death care', 'graveyard'], type: 'cemiterio' },
  { keywords: ['renda', 'r rend', 'rendimentos', 'properties', 'real estate', 'patrimonial'], type: 'renda' },
];

const TICKER_OVERRIDES = {
  'AFHI11': 'papel',
  'ALZR11': 'renda',
  'BIDB11': 'outros',
  'BRCR11': 'renda',
  'BTLG11': 'logistica',
  'CPTS11': 'renda',
  'EGAF11': 'agro',
  'GGRC11': 'renda',
  'HGJH11': 'papel',
  'HGLG11': 'logistica',
  'HGRE11': 'renda',
  'HGRU11': 'renda',
  'JSRE11': 'renda',
  'KNIP11': 'renda',
  'KNRI11': 'renda',
  'MXRF11': 'papel',
  'PVBI11': 'lajes corporativas',
  'RBRR11': 'renda',
  'RBVA11': 'outros',
  'RCRB11': 'renda',
  'RECR11': 'papel',
  'TGAR11': 'renda',
  'VINO11': 'lajes corporativas',
  'VISC11': 'shopping',
  'VRTA11': 'renda',
  'XPLG11': 'logistica',
  'XPML11': 'shopping',
};

function classifyFII(ticker, name) {
  const upperTicker = ticker.toUpperCase();

  if (TICKER_OVERRIDES[upperTicker]) {
    return TICKER_OVERRIDES[upperTicker];
  }

  if (!name) return null;

  const upperName = name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      const upperKw = kw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (upperName.includes(upperKw) || upperTicker.includes(upperKw)) {
        return rule.type;
      }
    }
  }

  return null;
}

async function main() {
  console.log('Carregando FIIs do banco...');
  const { rows: fiis } = await pool.query(
    "SELECT id, ticker, name FROM b3_assets WHERE assettype = 'fii' ORDER BY ticker"
  );
  console.log(`Total de FIIs: ${fiis.length}\n`);

  const counts = {};
  let classified = 0;
  let unclassified = 0;

  for (const fii of fiis) {
    const type = classifyFII(fii.ticker, fii.name);
    if (type) {
      await pool.query('UPDATE b3_assets SET fiitype = $1 WHERE id = $2', [type, fii.id]);
      counts[type] = (counts[type] || 0) + 1;
      classified++;
      console.log(`  ${fii.ticker} → ${type}`);
    } else {
      unclassified++;
      console.log(`  ${fii.ticker} → ??? (sem classificação)`);
    }
  }

  console.log('\n========== RESUMO ==========');
  console.log(`Classificados: ${classified}`);
  console.log(`Nao classificados: ${unclassified}`);
  console.log('\nDistribuicao por tipo:');
  for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  await pool.end();
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
