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
2. Import project in Vercel  
3. **Framework preset:** Other  
4. **Build command:** `npm run build`  
5. **Install command:** `npm install`  
6. Add environment variables  
7. Deploy  

All routes are handled by `api/index.js` (Express). `vercel.json` rewrites traffic to the API.

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
