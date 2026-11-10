// Command-line entry: `npm start`.
import { startServer } from './app.js';

const server = await startServer();

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
