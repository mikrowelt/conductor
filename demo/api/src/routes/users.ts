/**
 * User routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { validateEmail } from '@demo/shared';

export const userRouter = Router();

// In-memory user store for demo
const users: Map<string, { id: string; name: string; email: string }> = new Map();

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

// Get all users
userRouter.get('/', (req, res) => {
  res.json(Array.from(users.values()));
});

// Get user by ID
userRouter.get('/:id', (req, res) => {
  const user = users.get(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// Create user
userRouter.post('/', (req, res) => {
  try {
    const data = createUserSchema.parse(req.body);

    if (!validateEmail(data.email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    const id = crypto.randomUUID();
    const user = { id, ...data };
    users.set(id, user);

    res.status(201).json(user);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete user
userRouter.delete('/:id', (req, res) => {
  const deleted = users.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(204).send();
});
