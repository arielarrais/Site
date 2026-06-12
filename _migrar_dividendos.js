const sqlite3 = require('sqlite3');
const { Client } = require('pg');

const PGCONFIG = {
  connectionString: 'postgresql://postgres:wdYjjTAKwyGOopdARgVrMNbrZRJrZQPv@yamanote.proxy.rlwy.net:40845/railway'
};

async function migrate() {
  const sqlite = new sqlite3.Database('C:\\Users\\Nvme\\Desktop\\GitHub\\Site\\database.sqlite');
  const pg = new Client(PGCONFIG);
  await pg.connect();
  console.log('Conectado ao PostgreSQL de produção.');

  // Ler dados do SQLite
  const dividends = await new Promise((resolve, reject) =>
    sqlite.all('SELECT * FROM asset_dividends', (err, rows) => err ? reject(err) : resolve(rows))
  );
  console.log(`Encontrados ${dividends.length} dividendos no SQLite.`);

  // Truncar tabela em prod
  await pg.query('TRUNCATE TABLE asset_dividends RESTART IDENTITY CASCADE');
  console.log('Tabela asset_dividends limpa em produção.');

  // Inserir dados
  for (const d of dividends) {
    await pg.query(
      `INSERT INTO asset_dividends (id, assetid, paymentdate, grossamount, netamount, description, createdat, comdate)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
      [d.id, d.assetId, d.paymentDate, d.grossAmount, d.netAmount || null, d.description || null, d.createdAt, d.comDate || null]
    );
  }
  console.log(`${dividends.length} dividendos inseridos no PostgreSQL.`);

  // Resetar sequence
  await pg.query("SELECT setval('asset_dividends_id_seq', (SELECT COALESCE(MAX(id),1) FROM asset_dividends))");
  console.log('Sequência resetada.');

  await pg.end();
  sqlite.close();
  console.log('Migração concluída!');
}

migrate().catch(err => { console.error('Erro:', err); process.exit(1); });
