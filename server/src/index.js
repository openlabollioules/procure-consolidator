import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { ingestXlsxBuffer, safeRun } from './db.js';
import { askLLM, generateResponse } from './llm.js';
import { jsonToSQL } from './jsonToSql.js';
import { getSchema } from './db.js';

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/* Health */
app.get('/health', (_req, res) => {
  res.json({ ok: true, model: process.env.OLLAMA_MODEL || 'gpt-oss:20b' });
});

/* Upload fichier */
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
    const tableNameHint = (req.body.table || req.file.originalname || 'table').replace(/\.(xlsx|csv)$/i, '');
    const out = await ingestXlsxBuffer(req.file.buffer, { tableNameHint });
    res.json(out);
  } catch (e) {
    console.error('[upload] error:', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message?.trim()) return res.status(400).json({ error: 'Message requis.' });

    const schema = getSchema();

    // 1) LLM -> JSON (intention)
    const intent = await askLLM({ schema, question: message });

    // 2) JSON -> SQL (notre code, pas le LLM)
    const sql = jsonToSQL(intent, schema);

    // 3) Exécution lecture seule
    const rows = await safeRun(sql);

    // 4) Génération d'une réponse en langage naturel
    const response = await generateResponse({ intent, rows, schema });

    res.json({ intent, sql, rows, response });
  } catch (e) {
    console.error('[/chat] error:', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* Schéma courant (tables + colonnes) */
app.get('/schema', (_req, res) => {
  try {
    const schema = getSchema();
    res.json({ tables: schema || {} });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* 404 */
app.use((_req, res) => {
  res.status(404).json({ error: 'Route non trouvée' });
});

const PORT = process.env.PORT || 8787;
app.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT}`));
