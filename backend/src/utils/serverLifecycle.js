// RouteWatch — robust listen + graceful shutdown.
// Fixes "Port 5000 is already in use" after `node --watch` restarts / Ctrl+C:
//  * on SIGINT/SIGTERM we close Socket.IO, HTTP keep-alive sockets and Mongo,
//    so the port is released immediately;
//  * if the port is still briefly held (old process exiting), we retry for ~10 s
//    instead of crashing on the first attempt.
function listenWithRetry(server, port, { retries = 20, delayMs = 500, host } = {}) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryListen = () => {
      const onError = (err) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' && attempt < retries) {
          attempt++;
          if (attempt === 1) console.warn(`[server] Port ${port} busy — waiting for it to be released…`);
          setTimeout(tryListen, delayMs);
          return;
        }
        if (err.code === 'EADDRINUSE') {
          const win = `Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`;
          err.message = `Port ${port} is still used by another process (probably a second "npm run dev" in another terminal).\n`
            + `    Close that terminal, or run:  ${process.platform === 'win32' ? win : `npx kill-port ${port}`}`;
        }
        reject(err);
      };
      const onListening = () => { server.off('error', onError); resolve(server); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    };
    tryListen();
  });
}

function installGracefulShutdown({ server, io, closeDb }) {
  let closing = false;
  const sockets = new Set();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  const shutdown = async (signal, code = 0) => {
    if (closing) return;
    closing = true;
    console.log(`[server] ${signal} — shutting down`);
    const force = setTimeout(() => process.exit(code), 4000);
    force.unref();
    try {
      io?.close();
      server.close();
      server.closeIdleConnections?.();
      for (const s of sockets) s.destroy();
      await closeDb?.();
    } catch (e) { console.error('[server] shutdown error', e); }
    clearTimeout(force);
    process.exit(code);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => shutdown(sig));
  process.on('unhandledRejection', (e) => console.error('[server] unhandled rejection (kept running):', e));
  process.on('uncaughtException', (e) => { console.error('[server] uncaught exception:', e); shutdown('uncaughtException', 1); });
}

module.exports = {
  listenWithRetry,
  installGracefulShutdown,
};
