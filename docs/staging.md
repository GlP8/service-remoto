# Staging environment on Render

Staging is a separately deployed test copy of Service Remoto. It must not use
the local development database, production database, production Stripe keys,
or a RustDesk executable that can initiate real connections.

No Render services or databases are created by these instructions. Review
Render's current plan and pricing in the dashboard before creating resources.
Use the same region for the API and PostgreSQL where possible.

## Create the staging database

Create a Render PostgreSQL instance named `service-remoto-staging` with the
database name `service_remoto_staging` and a dedicated staging database user.
Do not reuse the local database or a production user. Use its **internal**
connection URL for the API. Percent-encode special characters in the database
password if constructing the URL manually.

## Create the API web service

Create a Render Web Service connected to the private GitHub repository:

- Root Directory: `services/api`
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`

The API compiles TypeScript to `dist` and starts the compiled server with Node;
Node 22 is pinned by `services/api/.node-version`. Render supplies `PORT`
automatically, so do not override it.

Configure the variables in
[`services/api/.env.staging.example`](../services/api/.env.staging.example)
using Render's environment settings. Set `DATABASE_URL` to the Render
PostgreSQL **internal** URL, and create a unique random `JWT_SECRET` of at
least 32 bytes in Render's secret settings. Never copy local or production
credentials into staging.

Use a temporary HTTPS `CLIENT_ORIGIN` while the static site is being created.
After obtaining the actual static-site URL, update both `CLIENT_ORIGIN` and
`CLIENT_APP_URL` to that exact staging origin, then redeploy the API. Leave
`RUSTDESK_EXECUTE=false`; leave Stripe unset unless a separate test-mode setup
is ready.

## Initialize the empty staging database

Before creating test accounts, confirm the API's `DATABASE_URL` points to the
new, empty `service_remoto_staging` database. In the Render API service shell,
from its root directory, initialize the schema once:

```sh
npx prisma db init --db "$DATABASE_URL"
```

This initializes and signs the current Prisma contract using additive
operations. Stop if it reports a conflict; do not point this command at local
or production data. Database schema changes after initialization need a
reviewed migration procedure before deployment.

## Create the static site

Create a Render Static Site connected to the same repository:

- Root Directory: `apps/client-web`
- Build Command: `npm ci && npm run build:staging`
- Publish Directory: `dist`
- Environment variable: `VITE_API_URL`, set to the API's HTTPS origin only

Use the API URL from the frontend template at
[`apps/client-web/.env.staging.example`](../apps/client-web/.env.staging.example).
Node 22 is pinned by `apps/client-web/.node-version`. Once Render assigns the
static-site URL, set it as the API's `CLIENT_ORIGIN` and `CLIENT_APP_URL` as
described above.

## Smoke-test

1. Check `https://<staging-api-host>/health` and `/ready`.
2. Open the staging client URL and create a dedicated test account.
3. Register a test computer and verify that a support ticket can be created,
   claimed by a staging technician, and closed.
4. Confirm the browser connects only to the staging API, including its
   WebSocket connection.
5. Confirm `RUSTDESK_EXECUTE` remains `false`; do not initiate a real remote
   session during these tests.
6. Delete test accounts and records according to the staging retention policy.

Do not connect production data, invite real customers, or enable live billing
until backups, restore procedures, monitoring, access control, and a rollback
plan have been validated.
