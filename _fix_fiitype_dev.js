const { Client } = require('pg');

const PG = process.env.DATABASE_URL || 'postgresql://postgres:admin@localhost:5432/site_db';

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
    console.log('Coluna fiitype adicionada em dev.');
  } else {
    console.log('Coluna fiitype ja existe em dev.');
  }
  await pg.end();
})();
