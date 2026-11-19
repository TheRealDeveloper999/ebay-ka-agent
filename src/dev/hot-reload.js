'use strict';

// Nunjucks declares an optional peer on Chokidar 3 for its unused watch mode.
const chokidar = require('chokidar-hot-reload');
const path = require('path');

// Unique ID per server process — clients detect a change and reload
const instanceId = Date.now().toString();
const clients = new Set();

function send(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(data) {
  for (const res of clients) send(res, data);
}

function mount(app) {
  app.get('/__hot-reload', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    clients.add(res);
    req.on('close', () => clients.delete(res));

    // Let the client know which server instance it's talking to.
    // If the stored ID differs (server restarted), the client reloads.
    send(res, { type: 'init', id: instanceId });
  });

  const root = path.join(__dirname, '../..');
  chokidar
    .watch(['views', 'public'], { cwd: root, ignoreInitial: true })
    .on('change', (file) => {
      console.log(`[hot-reload] ${file}`);
      broadcast({ type: 'reload' });
    });

  console.log('[hot-reload] watching views/ and public/');
}

module.exports = { mount };
