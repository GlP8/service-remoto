import { Router } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.middleware.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { notifyClientTicketUpdate, notifyTicketCreated, notifyTicketUpdated } from '../../infrastructure/realtime/technician-hub.js';
import { claimTicket, closeTicket, connectTicket, createTicket, disconnectTicket, listTickets, TicketActionError } from './ticket.service.js';

export const ticketRouter = Router();

ticketRouter.use(requireAuth);

ticketRouter.post('/', requireRole('CLIENT'), async (request: AuthenticatedRequest, response) => {
  const { computerId } = request.body as { computerId?: unknown };
  const parsedComputerId = computerId === undefined ? undefined : Number(computerId);

  if (parsedComputerId !== undefined && !Number.isInteger(parsedComputerId)) {
    response.status(400).json({ error: 'computerId must be an integer' });
    return;
  }

  try {
    const ticket = await createTicket(request.userId!, parsedComputerId);
    notifyTicketCreated(ticket);
    response.status(201).json({ ticket });
  } catch (error) {
    if (error instanceof Error && error.message === 'OPEN_TICKET_EXISTS') {
      response.status(409).json({ error: 'You already have an open support request' });
      return;
    }
    if (error instanceof Error && error.message === 'COMPUTER_NOT_FOUND') {
      response.status(404).json({ error: 'Computer not found for this user' });
      return;
    }
    response.status(500).json({ error: 'Unable to create ticket' });
  }
});

ticketRouter.get('/', async (request: AuthenticatedRequest, response) => {
  try {
    const tickets = await listTickets(request.userId!, request.userRole!);
    response.json({ tickets });
  } catch {
    response.status(500).json({ error: 'Unable to list tickets' });
  }
});

ticketRouter.patch('/:ticketId/claim', requireRole('TECHNICIAN', 'ADMIN'), async (request: AuthenticatedRequest, response) => {
  const ticketId = Number(request.params['ticketId']);
  if (!Number.isInteger(ticketId)) {
    response.status(400).json({ error: 'ticketId must be an integer' });
    return;
  }

  const ticket = await claimTicket(ticketId, request.userId!);
  if (!ticket) {
    response.status(409).json({ error: 'Ticket is not available for claiming' });
    return;
  }
  notifyTicketUpdated(ticket);
  response.json({ ticket });
});

ticketRouter.patch('/:ticketId/close', requireRole('TECHNICIAN', 'ADMIN'), async (request: AuthenticatedRequest, response) => {
  const ticketId = Number(request.params['ticketId']);
  if (!Number.isInteger(ticketId)) {
    response.status(400).json({ error: 'ticketId must be an integer' });
    return;
  }

  const ticket = await closeTicket(ticketId, request.userId!, request.userRole === 'ADMIN');
  if (!ticket) {
    response.status(409).json({ error: 'Ticket is not active or is assigned to another technician' });
    return;
  }
  notifyTicketUpdated(ticket);
  response.json({ ticket });
});

ticketRouter.post('/:ticketId/disconnect', async (request: AuthenticatedRequest, response) => {
  const ticketId = Number(request.params['ticketId']);
  const authenticatedUserId = request.userId;
  if (!Number.isInteger(ticketId)) {
    response.status(400).json({ error: 'ticketId must be an integer' });
    return;
  }
  if (!authenticatedUserId) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const updatedTicket = await disconnectTicket(ticketId, authenticatedUserId);
    notifyClientTicketUpdate(updatedTicket.clientId, updatedTicket);
    response.status(200).json({ ticket: updatedTicket });
  } catch (error) {
    if (error instanceof TicketActionError && error.code === 'TICKET_NOT_FOUND') {
      response.status(404).json({ error: 'Ticket not found' });
      return;
    }
    if (error instanceof TicketActionError && error.code === 'TICKET_FORBIDDEN') {
      response.status(403).json({ error: 'You cannot disconnect another client ticket' });
      return;
    }
    if (error instanceof TicketActionError && error.code === 'TICKET_NOT_ACTIVE') {
      response.status(409).json({ error: 'Ticket is not active' });
      return;
    }
    response.status(500).json({ error: 'Unable to disconnect ticket' });
  }
});

ticketRouter.post('/:ticketId/connect', requireRole('TECHNICIAN', 'ADMIN'), async (request: AuthenticatedRequest, response) => {
  const ticketId = Number(request.params['ticketId']);
  if (!Number.isInteger(ticketId)) {
    response.status(400).json({ error: 'ticketId must be an integer' });
    return;
  }

  try {
    const connection = await connectTicket(ticketId, request.userId!, request.userRole === 'ADMIN');
    if (connection.connected) {
      notifyTicketUpdated({
        id: connection.ticketId,
        clientId: connection.clientId!,
        status: 'ACTIVE',
        technicianId: connection.technicianId ?? null,
        technicianName: connection.technicianName,
        connectedAt: connection.connectedAt,
        disconnectedAt: connection.disconnectedAt,
      });
    }
    response.json(connection);
  } catch (error) {
    if (error instanceof Error && error.message === 'TICKET_NOT_AVAILABLE') {
      response.status(409).json({ error: 'Ticket is not active or is assigned to another technician' });
      return;
    }
    if (error instanceof Error && error.message === 'COMPUTER_NOT_ASSOCIATED') {
      response.status(409).json({ error: 'Ticket has no computer associated' });
      return;
    }
    if (error instanceof Error && error.message === 'RUSTDESK_BIN_NOT_CONFIGURED') {
      response.status(503).json({ error: 'RustDesk executable is not configured' });
      return;
    }
    if (error instanceof Error && (error.message === 'INVALID_RUSTDESK_ID' || error.message === 'RUSTDESK_BIN_MUST_BE_ABSOLUTE')) {
      response.status(503).json({ error: 'RustDesk configuration is invalid' });
      return;
    }
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'ENOENT' || error.code === 'EACCES')) {
      response.status(503).json({ error: 'RustDesk executable is unavailable' });
      return;
    }
    response.status(500).json({ error: 'Unable to start RustDesk session' });
  }
});
