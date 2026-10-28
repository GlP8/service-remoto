import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { env } from '../../config/env.js';
import { bearerToken, verifyToken } from '../../modules/auth/auth.middleware.js';

const technicians = new Set<WebSocket>();
const clients = new Map<WebSocket, number>();
const clientAgents = new Map<WebSocket, number>();
const clientAgentAlive = new WeakMap<WebSocket, boolean>();

const clientAgentHeartbeat = setInterval(() => {
  for (const agent of clientAgents.keys()) {
    if (agent.readyState !== WebSocket.OPEN) continue;
    if (clientAgentAlive.get(agent) === false) {
      agent.terminate();
      continue;
    }
    clientAgentAlive.set(agent, false);
    agent.ping();
  }
}, 30_000);
clientAgentHeartbeat.unref();

const allowedOrigins = new Set([
  env.CLIENT_ORIGIN,
  ...(env.NODE_ENV === 'development'
    ? ['http://localhost:5173', 'http://127.0.0.1:5173']
    : []),
]);

export function isAllowedWebSocketOrigin(origin: string | undefined) {
  return origin === undefined || allowedOrigins.has(origin);
}

export function setupTechnicianWebSocket(server: Server) {
  const socketServer = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // Native agents send the token in a header so it stays out of URLs and access logs;
    // browsers cannot set WebSocket headers, so they keep using the query parameter.
    const token = bearerToken(request.headers.authorization) || url.searchParams.get('token');
    const identity = token ? verifyToken(token) : null;
    const origin = request.headers.origin;
    const isTechnicianChannel = url.pathname === '/ws/technicians';
    const isClientChannel = url.pathname === '/ws/client';
    const isClientAgentChannel = url.pathname === '/ws/agent';
    if (
      (!isTechnicianChannel && !isClientChannel && !isClientAgentChannel) ||
      !identity ||
      (Array.isArray(origin) ? origin.some((value) => !isAllowedWebSocketOrigin(value)) : !isAllowedWebSocketOrigin(origin))
    ) {
      socket.destroy();
      return;
    }
    if (isTechnicianChannel && identity.role !== 'TECHNICIAN' && identity.role !== 'ADMIN') {
      socket.destroy();
      return;
    }
    if ((isClientChannel || isClientAgentChannel) && identity.role !== 'CLIENT') {
      socket.destroy();
      return;
    }

    socketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (identity.role === 'CLIENT') {
        if (isClientAgentChannel) {
          clientAgents.set(webSocket, identity.userId);
          clientAgentAlive.set(webSocket, true);
          webSocket.on('pong', () => clientAgentAlive.set(webSocket, true));
          webSocket.send(JSON.stringify({ type: 'connected', channel: 'agent' }));
          webSocket.on('close', () => clientAgents.delete(webSocket));
        } else {
          clients.set(webSocket, identity.userId);
          webSocket.send(JSON.stringify({ type: 'connected', channel: 'client' }));
          webSocket.on('close', () => clients.delete(webSocket));
        }
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

function sendToClient(connections: Map<WebSocket, number>, clientId: number, event: string) {
  let delivered = false;
  for (const [client, userId] of connections) {
    if (userId === clientId && client.readyState === WebSocket.OPEN) {
      client.send(event);
      delivered = true;
    }
  }
  return delivered;
}

export function notifyTicketUpdated(ticket: { id: number; clientId: number; status: string; technicianId: number | null; technicianName?: string | null; connectedAt?: string | null; disconnectedAt?: string | null }) {
  const event = JSON.stringify({ type: 'ticket.updated', ticket });
  sendToClient(clients, ticket.clientId, event);
  sendToClient(clientAgents, ticket.clientId, event);
}

export function notifyClientTicketUpdate(
  clientId: number,
  ticket: { id: number; clientId: number; status: string; technicianId: number | null; technicianName?: string | null; connectedAt?: string | null; disconnectedAt?: string | null },
) {
  const event = JSON.stringify({ type: 'ticket.updated', ticket: { ...ticket, clientId } });
  sendToClient(clients, clientId, event);
  sendToClient(clientAgents, clientId, event);
  for (const technician of technicians) {
    if (technician.readyState === WebSocket.OPEN) technician.send(event);
  }
}

export function notifyClientConnectionRequested(
  clientId: number,
  request: {
    ticketId: number;
    technicianId: number;
    technicianName: string | null;
    rustdeskId: string;
  },
) {
  return sendToClient(clientAgents, clientId, JSON.stringify({ type: 'connection.requested', request }));
}

export function notifyConnectionApproved(approval: { ticketId: number; clientId: number; technicianId: number; approvedAt: string }) {
  const event = JSON.stringify({ type: 'connection.approved', approval });
  for (const technician of technicians) {
    if (technician.readyState === WebSocket.OPEN) technician.send(event);
  }
  sendToClient(clients, approval.clientId, event);
}
