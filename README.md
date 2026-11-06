# MerchSys
University Merchandise Pre-Order System | IT 118 Systems Integration and Architecture 1 (BSIT 3rd Year)
Students pre-order merchandise and pay via GCash; staff manage orders; admins see analytics.

## Architecture
```
Browser (HTML/Bootstrap/Chart.js)
      |  HTTPS + JWT
Vercel (static files + Express serverless API)
      |------> Supabase: PostgreSQL, Auth, Storage
      |------> Maya Checkout (sandbox) or PayMongo: online payment, confirmed by asking the provider
      '------> Resend: email notifications
```

## Structure
```
api/index.js        Express app (Vercel entry point)
server.js           Local dev server
routes/             auth, products, orders, payments, users, analytics
lib/                supabase client, mailer (Resend), payment gateway adapter (Maya / PayMongo)
middleware/auth.js  JWT check + role guards
db/schema.sql       Tables, indexes, RLS, storage buckets, transactional functions
public/             Frontend pages
docs/               Requirements document, setup guide
```

## API summary
| Method and path | Access | Purpose |
|---|---|---|
| POST /api/auth/register, /login, /refresh | public | Accounts |
| GET/PUT /api/auth/me | user | Profile |
| GET /api/products | public | Shop catalog (edge-cached) |
| POST/PUT/DELETE /api/products | staff | Manage products and images |
| POST /api/orders | user | Place order (atomic stock deduction) |
| GET /api/orders/mine, /:id | user | Track orders |
| POST /api/orders/:id/receipt, /cancel | user | Manual GCash receipt, cancel |
| GET /api/settings/payment | user | Merch GCash name and number for manual payments |
| PUT /api/settings/payment | admin | Update the merch GCash account |
| GET /api/orders, PATCH /:id/status, /:id/payment | staff | Fulfilment |
| POST /api/payments/checkout | user | Start online payment (Maya or PayMongo) |
| GET /api/payments/verify/:orderId | user/staff | Re-check payment with the provider |
| POST /api/payments/webhook | PayMongo | Payment confirmation (optional) |
| GET /api/analytics | staff | Dashboard and chart data |
| GET/PATCH /api/users | admin | User roles |

See `docs/SETUP.md` to run and deploy.
