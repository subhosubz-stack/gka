# Deploy GharKaAdda on Vercel

## Prerequisites

1. [Vercel](https://vercel.com) account  
2. PostgreSQL database ([Neon](https://neon.tech) recommended — works with `DATABASE_URL` + SSL)  
3. Git repository connected to Vercel  

## Environment variables (Vercel project → Settings → Environment Variables)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | `postgresql://...?sslmode=require` |
| `JWT_SECRET` | Yes | Long random string |
| `FRONTEND_ORIGIN` | Yes | `https://your-app.vercel.app` |
| `GOOGLE_CLIENT_ID` | Optional | Google Sign-In |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Optional | Payments |
| `CRON_SECRET` | Recommended | Random string for `/api/cron/expiry` |
| `VERIFICATION_DEV_MODE` | Dev only | `false` in production |

Vercel sets `VERCEL=1` automatically.

## Deploy steps

1. Push code to GitHub  
2. Import project in Vercel → **subhosubz-stack/gka**  
3. **Framework preset:** Other  
4. **Build command:** `npm run build` (auto from `vercel.json`)  
5. **Output directory:** `dist` (auto from `vercel.json`)  
6. Add **all** environment variables below (Production + Preview)  
7. Deploy  
8. Set `FRONTEND_ORIGIN` to your exact Vercel URL, then **Redeploy**

**How it works:** HTML/JS/CSS are served from `dist/`. Only `/api/*` hits the Express serverless function (`api/index.js`).

## Troubleshooting

| Symptom | Fix |
|--------|-----|
| “Cannot reach the API” on login | Add `DATABASE_URL` + `JWT_SECRET` in Vercel env, redeploy |
| Google Sign-In missing | Add `GOOGLE_CLIENT_ID`; add `https://YOUR-APP.vercel.app` in Google Console origins |
| Login works but data empty | Run `npm run db:sync` locally once (same `DATABASE_URL`) |
| 404 on pages | Ensure latest deploy uses `outputDirectory: dist` in `vercel.json` |
| Build failed | Check Vercel build logs; run `npm run build` locally |

**Do not use Netlify** for this repo without a separate Node API — use Vercel.

## Local development

```bash
npm install
cp .env.example .env
# Edit .env with DATABASE_URL
npm run db:sync
npm run dev
```

Open **http://127.0.0.1:3000**

## Limitations on Vercel

- **File uploads** (`/uploads`) do not persist on serverless. Use [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) or Cloudinary for production image storage.  
- **Background jobs** use Vercel Cron → `GET /api/cron/expiry` (hourly). Set `CRON_SECRET` and configure cron auth in Vercel dashboard if needed.  
- **Hobby plan:** 10s function timeout; upgrade or set `maxDuration` in `vercel.json` for heavy operations.  

## Listing QR codes

Each property has a public card at:

`https://your-domain.vercel.app/listing.html?id={property-uuid}`

QR appears when users open **View details** on a listing. Scan shows rent, amenities, owner/broker/platform type.
