import { Router } from 'express';
import db from '../db.js';

const router = Router();

router.post('/push', (req, res) => {
  const { client_id, changes } = req.body;

  if (!client_id || !Array.isArray(changes)) {
    res.status(400).json({ error: 'client_id and changes[] are required' });
    return;
  }

  const insert = db.prepare(`
    INSERT INTO sync_log (client_id, action, entity_type, entity_id, payload, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  let accepted = 0;

  const transaction = db.transaction(() => {
    for (const change of changes) {
      const { action, entity_type, entity_id, payload } = change;

      if (!action || !entity_type || !entity_id) {
        continue;
      }

      insert.run(client_id, action, entity_type, entity_id, JSON.stringify(payload ?? {}), now);
      accepted++;
    }
  });

  transaction();

  res.json({ accepted, timestamp: now });
});

router.post('/pull', (req, res) => {
  const { client_id, since } = req.body;

  if (!client_id) {
    res.status(400).json({ error: 'client_id is required' });
    return;
  }

  const sinceTimestamp = since ?? '1970-01-01T00:00:00.000Z';

  const changes = db
    .prepare(
      `SELECT action, entity_type, entity_id, payload, timestamp
       FROM sync_log
       WHERE timestamp > ? AND client_id != ?
       ORDER BY timestamp ASC`
    )
    .all(sinceTimestamp, client_id);

  const parsed = (changes as Record<string, unknown>[]).map((row) => ({
    ...row,
    payload: JSON.parse(row.payload as string),
  }));

  res.json({
    changes: parsed,
    server_timestamp: new Date().toISOString(),
  });
});

export default router;
