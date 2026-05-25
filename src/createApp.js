import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import authRouter from './routes/auth.js';
import propertiesRouter from './routes/properties.js';
import tenantRouter from './routes/tenant.js';
import ownerRouter from './routes/owner.js';
import brokerRouter from './routes/broker.js';
import adminRouter from './routes/admin.js';
import conversationsRouter from './routes/conversations.js';
import notificationsRouter from './routes/notifications.js';
import paymentsRouter from './routes/payments.js';
import configRouter from './routes/config.js';
import tiffinRouter from './routes/tiffin.js';
import superAdminRouter from './routes/superAdmin.js';
import propertyAdminRouter from './routes/propertyAdmin.js';
import servicesRouter from './routes/services.js';
import supportRouter from './routes/support.js';
import { pageGuardMiddleware } from './middleware/pageGuard.js';
import { isDatabaseConfigured } from './db.js';
import { ensureCoreSchema } from './services/ensureSchema.js';
import { ensureChatTemplates } from './services/chatTemplates.js';
import {
  startContactUnlockExpiryJob,
  expireContactUnlocks,
  expirePropertyLocks
} from './jobs/contactUnlockExpiry.js';

const isVercel = Boolean(process.env.VERCEL);
const isProduction = process.env.NODE_ENV === 'production' || isVercel;

function corsOriginCheck(origin, callback) {
  if (!origin) return callback(null, true);
  const allowed =
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.includes('vercel.app') ||
    origin.includes('run.app') ||
    origin.includes('googleusercontent.com') ||
    origin.startsWith('https://ais-') ||
    origin === process.env.FRONTEND_ORIGIN;
  callback(null, allowed);
}

export async function createApp({ enableVite = false } = {}) {
  const app = express();

  app.use(
    cors({
      origin: corsOriginCheck,
      credentials: true
    })
  );
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: true, limit: '20mb' }));
  app.use(cookieParser());

  if (!isVercel) {
    try {
      const uploadsPath = path.join(process.cwd(), 'uploads');
      fs.mkdirSync(path.join(uploadsPath, 'properties'), { recursive: true });
      app.use('/uploads', express.static(uploadsPath));
    } catch (err) {
      console.warn('[GKA] Uploads directory unavailable:', err.message);
    }
  }

  app.get('/api/health', (req, res) => {
    res.json({
      ok: true,
      message: 'GharKaAdda API running',
      databaseConfigured: isDatabaseConfigured(),
      vercel: isVercel
    });
  });

  app.get('/api/cron/expiry', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization;
    if (secret && auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!isDatabaseConfigured()) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    try {
      const expired_unlocks = await expireContactUnlocks();
      const expired_locks = await expirePropertyLocks();
      return res.json({ ok: true, expired_unlocks, expired_locks });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api/tenant', tenantRouter);
  app.use('/api/owner', ownerRouter);
  app.use('/api/broker', brokerRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/tiffin', tiffinRouter);
  app.use('/api/super-admin', superAdminRouter);
  app.use('/api/property-admin', propertyAdminRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/support', supportRouter);

  app.use(pageGuardMiddleware);

  if (enableVite && !isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const rootPath = process.cwd();
    app.use(express.static(distPath));
    app.use(express.static(rootPath, { index: false, extensions: ['html'] }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      const rel = req.path.replace(/^\//, '') || 'index.html';
      const candidates = [
        path.join(rootPath, rel),
        path.join(rootPath, rel.endsWith('.html') ? rel : `${rel}.html`),
        path.join(rootPath, rel, 'index.html')
      ];
      for (const filePath of candidates) {
        try {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            return res.sendFile(filePath);
          }
        } catch (_) {}
      }
      const fallback = path.join(distPath, 'index.html');
      if (fs.existsSync(fallback)) return res.sendFile(fallback);
      return res.status(404).send('Page not found');
    });
  }

  if (isDatabaseConfigured() && !global.__gkaSchemaReady && !global.__gkaSchemaInitStarted) {
    global.__gkaSchemaInitStarted = true;
    Promise.all([ensureCoreSchema(), ensureChatTemplates()])
      .then(() => {
        global.__gkaSchemaReady = true;
        console.log('[GKA] Database schema ready.');
      })
      .catch((err) => {
        console.error('[GKA] Schema init failed:', err.message || err);
      });
    if (!isVercel) {
      startContactUnlockExpiryJob();
    }
  }

  return app;
}
