import duckdb from 'duckdb';
import { read, utils } from 'xlsx';

const db = new duckdb.Database(':memory:');
const conn = db.connect();

// Schéma en mémoire
const catalog = { tables: {} };

function esc(id) { return id.replace(/"/g, '""'); }

export function getSchema() { return catalog.tables; }

export async function runSQL(sql) {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

export async function safeRun(sql) {
  const forbidden = /\b(create|insert|update|delete|drop|alter|attach|copy|load|truncate|vacuum)\b/i;
  if (forbidden.test(sql)) throw new Error('SQL non autorisé');
  return runSQL(sql);
}

export async function ingestXlsxBuffer(buf, { tableNameHint }) {
  const wb = read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = utils.sheet_to_json(ws, { defval: null });
  if (!rows.length) throw new Error('Fichier vide');

  const headers = Object.keys(rows[0]);
  const normHeaders = headers.map(h => h.toLowerCase().replace(/\s+/g, '_'));

  const table = tableNameHint.toLowerCase();
  const ddl = `CREATE OR REPLACE TABLE "${esc(table)}" (${normHeaders.map(h => `"${esc(h)}" VARCHAR`).join(', ')});`;
  await runSQL(ddl);

  for (const r of rows) {
    const vals = normHeaders.map((h, i) => {
      const v = r[headers[i]];
      if (v == null) return 'NULL';
      return `'${String(v).replace(/'/g, "''")}'`;
    });
    await runSQL(`INSERT INTO "${esc(table)}" (${normHeaders.map(h => `"${esc(h)}"`).join(',')}) VALUES (${vals.join(',')});`);
  }

  const cols = normHeaders.map((h, i) => ({ name: h, type: 'VARCHAR', original: headers[i] }));
  catalog.tables[table] = cols;

  return { table, columns: cols, created: true, intitules: false };
}
