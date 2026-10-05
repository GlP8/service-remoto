import 'dotenv/config';
import { createServer } from 'node:http';
import { app } from './app.js';
import { setupTechnicianWebSocket } from './infrastructure/realtime/technician-hub.js';
import { env } from './config/env.js';

const server = createServer(app);
setupTechnicianWebSocket(server);

server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${env.PORT}`);
});
