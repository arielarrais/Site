const { Client } = require('pg');

const PG = 'postgresql://postgres:wdYjjTAKwyGOopdARgVrMNbrZRJrZQPv@yamanote.proxy.rlwy.net:40845/railway';

(async () => {
  const pg = new Client({ connectionString: PG });
  await pg.connect();
  const { rows } = await pg.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'b3_assets'"
  );
  console.log('Colunas:', rows.map(r => r.column_name));
  const cols = rows.map(r => r.column_name);
  if (!cols.includes('fiitype')) {
    await pg.query('ALTER TABLE b3_assets ADD COLUMN fiitype TEXT');
    console.log('Coluna fiitype adicionada.');
  } else {
    console.log('Coluna fiitype ja existe.');
  }
  await pg.end();
})();
