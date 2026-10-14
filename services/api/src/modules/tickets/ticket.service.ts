import { randomUUID } from 'node:crypto';
import { db } from '../../../prisma/db.js';
import { pool } from '../../infrastructure/database/pool.js';

const TICKET_COLUMNS = `id, "clientId", "technicianId", "computerId", status,
  "rustdeskSessionToken", "connectedAt", "disconnectedAt", "createdAt", "updatedAt"`;

type TicketRecord = {
  id: number;
  clientId: number;
  technicianId: number | null;
  computerId: number | null;
  status: 'PENDING' | 'ACTIVE' | 'CLOSED';
  rustdeskSessionToken: string;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function createTicket(clientId: number, computerId?: number) {
  const openTicket = await pool.query<{ id: number }>(
    `SELECT id FROM ticket
     WHERE "clientId" = $1 AND status IN ('PENDING', 'ACTIVE')
     LIMIT 1`,
    [clientId],
  );
  if (openTicket.rowCount) throw new Error('OPEN_TICKET_EXISTS');

  if (computerId !== undefined) {
    const computer = await pool.query<{ id: number }>(
      'SELECT id FROM computer WHERE id = $1 AND "userId" = $2',
      [computerId, clientId],
    );
    if (computer.rowCount === 0) throw new Error('COMPUTER_NOT_FOUND');
  }

  const result = await pool.query<TicketRecord>(
    `INSERT INTO ticket ("clientId", "computerId", status, "rustdeskSessionToken", "createdAt", "updatedAt")
     VALUES ($1, $2, 'PENDING', $3, now(), now())
     RETURNING ${TICKET_COLUMNS}`,
    [clientId, computerId ?? null, randomUUID()],
  );

  return result.rows[0];
}

export async function listTickets(userId: number, role: string) {
  const condition = role === 'CLIENT' ? '"clientId" = $1' : '"technicianId" = $1 OR "technicianId" IS NULL';
  const result = await pool.query<TicketRecord>(
    `SELECT ${TICKET_COLUMNS}
     FROM ticket WHERE ${condition} ORDER BY "createdAt" DESC`,
    [userId],
  );
  return result.rows;
}

export async function claimTicket(ticketId: number, technicianId: number) {
  const result = await pool.query<TicketRecord>(
    `UPDATE ticket
     SET "technicianId" = $2, status = 'ACTIVE', "updatedAt" = now()
     WHERE id = $1 AND status = 'PENDING' AND "technicianId" IS NULL
     RETURNING ${TICKET_COLUMNS}`,
    [ticketId, technicianId],
  );
  return result.rows[0] ?? null;
}

export async function closeTicket(ticketId: number, userId: number, isAdmin: boolean) {
  const result = await pool.query<TicketRecord>(
    `UPDATE ticket
     SET status = 'CLOSED',
       "disconnectedAt" = CASE WHEN "connectedAt" IS NOT NULL THEN now() ELSE "disconnectedAt" END,
       "updatedAt" = now()
     WHERE id = $1 AND status = 'ACTIVE'
       AND ($2 = true OR "technicianId" = $3)
     RETURNING ${TICKET_COLUMNS}`,
    [ticketId, isAdmin, userId],
  );
  const ticket = result.rows[0] ?? null;
  if (ticket?.technicianId && ticket.connectedAt && ticket.disconnectedAt) {
    await pool.query(
      `INSERT INTO "connectionAuditLog" ("ticketId", "technicianId", action, "occurredAt", reason)
       SELECT $1, "technicianId", 'ENDED', "disconnectedAt", $2 FROM ticket WHERE id = $1`,
      [ticket.id, 'ticket closed by technician or administrator'],
    );
  }
  return ticket;
}

export class TicketActionError extends Error {
  constructor(
    readonly code: 'TICKET_NOT_FOUND' | 'TICKET_FORBIDDEN' | 'TICKET_NOT_ACTIVE',
    message: string,
  ) {
    super(message);
    this.name = 'TicketActionError';
  }
}

const CLIENT_AGENT_DISCONNECT_REASON = 'Sesión finalizada por el agente local del cliente';

export async function disconnectTicket(ticketId: number, authenticatedUserId: number): Promise<TicketRecord> {
  const ticket = await db.orm.public.Ticket.where({ id: ticketId }).first();
  if (!ticket) {
    throw new TicketActionError('TICKET_NOT_FOUND', 'Ticket not found');
  }
  if (ticket.clientId !== authenticatedUserId) {
    throw new TicketActionError('TICKET_FORBIDDEN', 'Ticket does not belong to the authenticated client');
  }
  if (ticket.status !== 'ACTIVE') {
    throw new TicketActionError('TICKET_NOT_ACTIVE', 'Ticket is not active');
  }

  const disconnectedAt = new Date().toISOString();

  const updatedTicket = await db.transaction(async (tx) => {
    const updated = await tx.orm.public.Ticket
      .where({ id: ticketId, clientId: authenticatedUserId, status: 'ACTIVE' })
      .select(
        'id',
        'clientId',
        'technicianId',
        'computerId',
        'status',
        'rustdeskSessionToken',
        'connectedAt',
        'disconnectedAt',
        'createdAt',
        'updatedAt',
      )
      .update({
        status: 'CLOSED',
        disconnectedAt,
      });

    const closedTicket = Array.isArray(updated) ? updated[0] : updated;
    if (!closedTicket) {
      throw new TicketActionError('TICKET_NOT_ACTIVE', 'Ticket is not active');
    }

    if (closedTicket.technicianId != null && closedTicket.connectedAt != null) {
      await tx.orm.public.ConnectionAuditLog.create({
        ticketId: closedTicket.id,
        technicianId: closedTicket.technicianId,
        action: 'ENDED',
        occurredAt: disconnectedAt,
        reason: CLIENT_AGENT_DISCONNECT_REASON,
      });
    }

    return closedTicket;
  });

  return updatedTicket;
}

export async function declineConnectionRequest(
  ticketId: number,
  authenticatedUserId: number,
): Promise<TicketRecord> {
  const result = await pool.query<TicketRecord>(
    `UPDATE ticket
     SET status = 'CLOSED', "updatedAt" = now()
     WHERE id = $1 AND "clientId" = $2 AND status = 'ACTIVE'
       AND "connectedAt" IS NULL
     RETURNING ${TICKET_COLUMNS}`,
    [ticketId, authenticatedUserId],
  );
  const ticket = result.rows[0];
  if (!ticket) {
    const existing = await pool.query<{ clientId: number; status: string }>(
      'SELECT "clientId", status FROM ticket WHERE id = $1',
      [ticketId],
    );
    if (!existing.rowCount) throw new TicketActionError('TICKET_NOT_FOUND', 'Ticket not found');
    if (existing.rows[0].clientId !== authenticatedUserId) {
      throw new TicketActionError('TICKET_FORBIDDEN', 'Ticket does not belong to the authenticated client');
    }
    throw new TicketActionError('TICKET_NOT_ACTIVE', 'Ticket is not awaiting client approval');
  }
  return ticket;
}

export async function connectTicket(ticketId: number, userId: number, isAdmin: boolean) {
  const result = await pool.query<{
    id: number;
    clientId: number;
    rustdeskId: string | null;
    technicianName: string | null;
  }>(
    `SELECT t.id, t."clientId", c."rustdeskId", u.name AS "technicianName"
     FROM ticket t
     LEFT JOIN computer c ON c.id = t."computerId"
     LEFT JOIN "user" u ON u.id = $3
     WHERE t.id = $1 AND t.status = 'ACTIVE'
       AND ($2 = true OR t."technicianId" = $3)`,
    [ticketId, isAdmin, userId],
  );
  const ticket = result.rows[0];

  if (!ticket) throw new Error('TICKET_NOT_AVAILABLE');
  if (!ticket.rustdeskId) throw new Error('COMPUTER_NOT_ASSOCIATED');
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(ticket.rustdeskId)) throw new Error('INVALID_RUSTDESK_ID');

  return {
    ticketId: ticket.id,
    clientId: ticket.clientId,
    technicianId: userId,
    technicianName: ticket.technicianName,
    rustdeskId: ticket.rustdeskId,
  };
}
