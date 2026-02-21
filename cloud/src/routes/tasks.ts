import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';

const router = Router();

router.post('/', (req, res) => {
  const { title, description, status, priority, employee_id, metadata } = req.body;

  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO cloud_tasks (id, title, description, status, priority, employee_id, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    title,
    description ?? '',
    status ?? 'pending',
    priority ?? 'normal',
    employee_id ?? null,
    now,
    now,
    JSON.stringify(metadata ?? {})
  );

  const task = db.prepare('SELECT * FROM cloud_tasks WHERE id = ?').get(id);
  res.status(201).json(task);
});

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit)) || 20, 1), 100);
  const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
  const status = req.query.status as string | undefined;

  let query = 'SELECT * FROM cloud_tasks';
  const params: unknown[] = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const tasks = db.prepare(query).all(...params);

  let countQuery = 'SELECT COUNT(*) as total FROM cloud_tasks';
  const countParams: unknown[] = [];
  if (status) {
    countQuery += ' WHERE status = ?';
    countParams.push(status);
  }
  const { total } = db.prepare(countQuery).get(...countParams) as { total: number };

  res.json({ tasks, total, limit, offset });
});

router.get('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM cloud_tasks WHERE id = ?').get(req.params.id);

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  res.json(task);
});

export default router;
