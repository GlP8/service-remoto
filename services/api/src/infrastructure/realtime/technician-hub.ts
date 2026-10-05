import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';
import { env } from '../../config/env.js';

const technicians = new Set<WebSocket>();
const clients = new Map<WebSocket, number>();
const validRoles = ['CLIENT', 'TECHNICIAN', 'ADMIN'] as const;

function isUserRole(role: unknown): role is typeof validRoles[number] {
  return typeof role === 'string' && validRoles.includes(role as typeof validRoles[number]);
}

function verifyToken(token: string) {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      audience: env.JWT_AUDIENCE,
      issuer: env.JWT_ISSUER,
    }) as jwt.JwtPayload;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0 || !isUserRole(payload.role)) return null;
    return { userId, role: payload.role };
  } catch {
    return null;
  }
}

export function setupTechnicianWebSocket(server: Server) {
  const socketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token');
    const identity = token ? verifyToken(token) : null;
    const isTechnicianChannel = url.pathname === '/ws/technicians';
    const isClientChannel = url.pathname === '/ws/client';
    if ((!isTechnicianChannel && !isClientChannel) || !identity) {
      socket.destroy();
      return;
    }
    if (isTechnicianChannel && identity.role !== 'TECHNICIAN' && identity.role !== 'ADMIN') {
      socket.destroy();
      return;
    }
    if (isClientChannel && identity.role !== 'CLIENT') {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (identity.role === 'CLIENT') {
        clients.set(webSocket, identity.userId);
        webSocket.send(JSON.stringify({ type: 'connected', channel: 'client' }));
        webSocket.on('close', () => clients.delete(webSocket));
        return;
      }
      technicians.add(webSocket);
      webSocket.send(JSON.stringify({ type: 'connected', channel: 'technicians' }));
      webSocket.on('close', () => technicians.delete(webSocket));
    });
  });
}

export function notifyTicketCreated(ticket: { id: number; status: string; rustdeskSessionToken: string }) {
  const event = JSON.stringify({ type: 'ticket.created', ticket });
  for (const technician of technicians) {
    if (technician.readyState === WebSocket.OPEN) technician.send(event);
  }
}

export function notifyTicketUpdated(ticket: { id: number; clientId: number; status: string; technicianId: number | null; technicianName?: string | null; connectedAt?: string | null; disconnectedAt?: string | null }) {
  const event = JSON.stringify({ type: 'ticket.updated', ticket });
  for (const [client, userId] of clients) {
    if (userId === ticket.clientId && client.readyState === WebSocket.OPEN) client.send(event);
  }
}

export function notifyClientTicketUpdate(
  clientId: number,
  ticket: { id: number; clientId: number; status: string; technicianId: number | null; technicianName?: string | null; connectedAt?: string | null; disconnectedAt?: string | null },
) {
  const event = JSON.stringify({ type: 'ticket.updated', ticket: { ...ticket, clientId } });
  for (const [client, userId] of clients) {
    if (userId === clientId && client.readyState === WebSocket.OPEN) client.send(event);
  }
  for (const technician of technicians) {
    if (technician.readyState === WebSocket.OPEN) technician.send(event);
  }
}
