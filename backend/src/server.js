require('dotenv').config();
const http = require('http');
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const connectDB = require('./config/db');
const { notFound, errorHandler, asyncHandler } = require('./middleware/error');
const Dataset = require('./models/Dataset');
const { sweep } = require('./services/datasets/files');
const { runDelete } = require('./services/datasets/importer');

/** After a restart: imports cannot resume, deletions can. */
async function recoverJobs() {
  const r = await Dataset.updateMany(
    { status: 'importing' },
    { status: 'failed', statusNote: 'The server restarted during this import. Rows imported before the restart are kept; delete the dataset or upload the file again.' }
  );
  if (r.modifiedCount) console.log(`[datasets] marked ${r.modifiedCount} interrupted import(s) as failed`);
  const stuck = await Dataset.find({ status: 'deleting' }).lean();
  for (const d of stuck) runDelete({ datasetId: d._id, user: null, io: app.get('io') }).catch(() => {});
  await sweep().catch(() => {});
}

const PORT = process.env.PORT || 5000;
const ORIGIN = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',');

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET missing — using an insecure development secret.');
  process.env.JWT_SECRET = 'dev-only-secret';
}

const app = express();
app.use(compression());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: ORIGIN, exposedHeaders: ['Content-Disposition'] }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/api/health', (_req, res) =>
  res.json({ ok: true, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' })
);
app.get('/api/dashboard', asyncHandler(async (_req, res) =>
  res.json(await require('./services/analytics').getDashboardStats())
));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/areas', require('./routes/areas'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/datasets', require('./routes/datasets'));
app.use('/api/ml', require('./routes/ml'));
app.use('/api/ai', require('./routes/ml'));
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });
io.on('connection', (s) => console.log(`[io] client ${s.id} connected`));
app.set('io', io);

process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

connectDB(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/routewatch_db')
  .then(async () => {
    // ensure every schema index (incl. 2dsphere) exists
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    await recoverJobs();
    server.listen(PORT, () => {
      console.log(`[api] RouteWatch API on http://localhost:${PORT}`);
      console.log(`[api] AI service expected at ${process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000'}`);
      require('./services/analytics').getDashboardStats().catch(() => {});
    });
    setInterval(() => sweep().catch(() => {}), 60 * 60 * 1000).unref();
    setInterval(() => require('./services/analytics').precomputeDashboardStats().catch(() => {}), 5 * 60 * 1000).unref();
  })
  .catch((err) => {
    console.error('[db] connection failed:', err.message);
    console.error('    Is MongoDB running? Check MONGODB_URI in backend/.env');
    process.exit(1);
  });
