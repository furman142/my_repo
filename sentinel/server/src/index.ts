// Command-line entry: `npm start`.
import { startServer } from './app.js';

const server = await startServer({
  // Command line: exit with a distinct code; a supervisor (systemd/launchd/Task Scheduler) or the
  // user starts it again with the new settings.
  restart: () => {
    console.log('SENTINEL: restart requested — exiting. Start it again (npm start) to apply the new settings.');
    void server.stop().then(() => process.exit(75));
  },
});

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
