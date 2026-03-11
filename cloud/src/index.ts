import express from 'express';
import cors from 'cors';
import tasksRouter from './routes/tasks.js';
import syncRouter from './routes/sync.js';

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

app.use(cors());
app.use(express.json());

app.use('/api/tasks', tasksRouter);
app.use('/api/sync', syncRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Agentry Cloud API listening on port ${PORT}`);
});
