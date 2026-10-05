import { Router } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.middleware.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { createComputer, listComputers, updateComputerStatus } from './computer.service.js';

export const computerRouter = Router();
computerRouter.use(requireAuth, requireRole('CLIENT'));

const computerSchema = z.object({
  os: z.string().trim().min(1).max(100),
  ram: z.string().trim().min(1).max(50),
  storageFree: z.string().trim().min(1).max(50),
  rustdeskId: z.string().trim().min(3).max(128),
  status: z.enum(['ONLINE', 'OFFLINE']).optional(),
});

computerRouter.post('/', async (request: AuthenticatedRequest, response) => {
  const parsed = computerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: 'os, ram, storageFree and rustdeskId are required' });
    return;
  }
  const { os, ram, storageFree, status } = parsed.data;
  const rustdeskId = parsed.data.rustdeskId.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(rustdeskId)) {
    response.status(400).json({ error: 'rustdeskId has an invalid format' });
    return;
  }

  try {
    const computer = await createComputer(request.userId!, {
      os,
      ram,
      storageFree,
      rustdeskId,
      status: status as 'ONLINE' | 'OFFLINE' | undefined,
    });
    response.status(201).json({ computer });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      response.status(409).json({ error: 'RustDesk ID already registered' });
      return;
    }
    response.status(500).json({ error: 'Unable to register computer' });
  }
});

computerRouter.get('/', async (request: AuthenticatedRequest, response) => {
  response.json({ computers: await listComputers(request.userId!) });
});

computerRouter.patch('/:computerId/status', async (request: AuthenticatedRequest, response) => {
  const computerId = Number(request.params['computerId']);
  const { status } = request.body as { status?: unknown };

  if (!Number.isInteger(computerId) || (status !== 'ONLINE' && status !== 'OFFLINE')) {
    response.status(400).json({ error: 'computerId and status ONLINE/OFFLINE are required' });
    return;
  }

  const computer = await updateComputerStatus(request.userId!, computerId, status);
  if (!computer) {
    response.status(404).json({ error: 'Computer not found for this user' });
    return;
  }
  response.json({ computer });
});
