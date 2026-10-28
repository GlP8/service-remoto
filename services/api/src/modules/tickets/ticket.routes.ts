import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.middleware.js';
import { requireAuth, requireRole } from '../auth/auth.middleware.js';
import { notifyClientConnectionRequested, notifyClientTicketUpdate, notifyConnectionApproved, notifyTicketCreated, notifyTicketUpdated } from '../../infrastructure/realtime/technician-hub.js';
import { approveConnectionRequest, claimTicket, closeTicket, connectTicket, createTicket, declineConnectionRequest, disconnectTicket, listTickets, TicketActionError } from './ticket.service.js';

export const ticketRouter = Router();

function parseTicketId(request: AuthenticatedRequest, response: Response) {
  const ticketId = Number(request.params['ticketId']);
  if (Number.isInteger(ticketId)) return ticketId;
  response.status(400).json({ error: 'ticketId must be an integer' });
  return null;
}

function sendClientTicketActionError(
  response: Response,
  error: unknown,
  messages: { forbidden: string; notActive: string; failed: string },
) {
  if (error instanceof TicketActionError && error.code === 'TICKET_NOT_FOUND') {
    response.status(404).json({ error: 'Ticket not found' });
    return;
  }
  if (error instanceof TicketActionError && error.code === 'TICKET_FORBIDDEN') {
    response.status(403).json({ error: messages.forbidden });
    return;
  }
  if (error instanceof TicketActionError && error.code === 'TICKET_NOT_ACTIVE') {
    response.status(409).json({ error: messages.notActive });
    return;
  }
  response.status(500).json({ error: messages.failed });
}

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
  const ticketId = parseTicketId(request, response);
  if (ticketId === null) return;

  const ticket = await claimTicket(ticketId, request.userId!);
  if (!ticket) {
    response.status(409).json({ error: 'Ticket is not available for claiming' });
    return;
  }
  notifyTicketUpdated(ticket);
  response.json({ ticket });
});

ticketRouter.patch('/:ticketId/close', requireRole('TECHNICIAN', 'ADMIN'), async (request: AuthenticatedRequest, response) => {
  const ticketId = parseTicketId(request, response);
  if (ticketId === null) return;

  const ticket = await closeTicket(ticketId, request.userId!, request.userRole === 'ADMIN');
  if (!ticket) {
    response.status(409).json({ error: 'Ticket is not active or is assigned to another technician' });
    return;
  }
  notifyTicketUpdated(ticket);
  response.json({ ticket });
});

ticketRouter.post('/:ticketId/disconnect', async (request: AuthenticatedRequest, response) => {
  const ticketId = parseTicketId(request, response);
  const authenticatedUserId = request.userId;
  if (ticketId === null) return;
  if (!authenticatedUserId) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const updatedTicket = await disconnectTicket(ticketId, authenticatedUserId);
    notifyClientTicketUpdate(updatedTicket.clientId, updatedTicket);
    response.status(200).json({ ticket: updatedTicket });
  } catch (error) {
    sendClientTicketActionError(response, error, {
      forbidden: 'You cannot disconnect another client ticket',
      notActive: 'Ticket is not active',
      failed: 'Unable to disconnect ticket',
    });
  }
});

ticketRouter.post('/:ticketId/decline', requireRole('CLIENT'), async (request: AuthenticatedRequest, response) => {
  const ticketId = parseTicketId(request, response);
  if (ticketId === null) return;

  try {
    const ticket = await declineConnectionRequest(ticketId, request.userId!);
    notifyClientTicketUpdate(ticket.clientId, ticket);
    response.json({ ticket });
  } catch (error) {
    sendClientTicketActionError(response, error, {
      forbidden: 'You cannot decline another client ticket',
      notActive: 'Ticket is not awaiting client approval',
      failed: 'Unable to decline connection request',
    });
  }
});

ticketRouter.post('/:ticketId/approve', requireRole('CLIENT'), async (request: AuthenticatedRequest, response) => {
  const ticketId = parseTicketId(request, response);
  if (ticketId === null) return;

  try {
    const approval = await approveConnectionRequest(ticketId, request.userId!);
    notifyConnectionApproved(approval);
    response.json({ approval });
  } catch (error) {
    sendClientTicketActionError(response, error, {
      forbidden: 'You cannot approve another client ticket',
      notActive: 'Ticket is not awaiting client approval',
      failed: 'Unable to approve connection request',
    });
  }
});

ticketRouter.post('/:ticketId/connect', requireRole('TECHNICIAN', 'ADMIN'), async (request: AuthenticatedRequest, response) => {
  const ticketId = parseTicketId(request, response);
  if (ticketId === null) return;

  try {
    const connection = await connectTicket(ticketId, request.userId!, request.userRole === 'ADMIN');
    const delivered = notifyClientConnectionRequested(connection.clientId, {
      ticketId: connection.ticketId,
      technicianId: connection.technicianId,
      technicianName: connection.technicianName,
      rustdeskId: connection.rustdeskId,
    });
    response.json({ ...connection, delivered });
  } catch (error) {
    if (error instanceof Error && error.message === 'TICKET_NOT_AVAILABLE') {
      response.status(409).json({ error: 'Ticket is not active or is assigned to another technician' });
      return;
    }
    if (error instanceof Error && error.message === 'COMPUTER_NOT_ASSOCIATED') {
      response.status(409).json({ error: 'Ticket has no computer associated' });
      return;
    }
    if (error instanceof Error && error.message === 'INVALID_RUSTDESK_ID') {
      response.status(409).json({ error: 'The client computer has an invalid RustDesk ID' });
      return;
    }
    response.status(500).json({ error: 'Unable to request client approval' });
  }
});
