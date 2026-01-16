/**
 * Demo API Service
 *
 * A simple Express API for testing Conductor.
 */

import express from 'express';
import { userRouter } from './routes/users.js';
import { healthRouter } from './routes/health.js';
import { formatDate, validateEmail } from '@demo/shared';

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/api/users', userRouter);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Demo API',
    version: '0.1.0',
    timestamp: formatDate(new Date()),
  });
});

app.listen(port, () => {
  console.log(`Demo API listening on port ${port}`);
});

export { app };
