# Staging environment

Staging is a separately deployed test copy of Service Remoto. It must not use
the local development database, production database, production Stripe keys,
or a RustDesk executable that can initiate real connections.

## Before provisioning

Choose a hosting provider for the React client, Node API, and managed or hosted
PostgreSQL. No provider or cloud resources are selected or created by this
repository change. Use separate staging and production projects, databases,
domains, and credentials.

Create a PostgreSQL database named `service_remoto_staging` and a dedicated
staging database user. Do not reuse the local database or a production user.
Percent-encode special characters in the database password before placing it in
the connection URL.

## API environment

Configure the API service with the variable names in
[`services/api/.env.staging.example`](../services/api/.env.staging.example).
Set actual values in the hosting provider's secret manager, not in source
control:

- `NODE_ENV=staging`
- `DATABASE_URL`: staging-only PostgreSQL connection
- `JWT_SECRET`: unique random value with at least 32 bytes
- `JWT_ISSUER=service-remoto-api-staging`
- `JWT_AUDIENCE=service-remoto-client-staging`
- `CLIENT_ORIGIN`: exact HTTPS origin of the staging web app, with no path
- `CLIENT_APP_URL`: staging web app URL
- `PORT`: the port required by the hosting provider, defaulting to `3000`
- `DIAGNOSTIC_CONSENT_VERSION`: current consent text version
- `RUSTDESK_EXECUTE=false`

Never copy the local or production JWT secret into staging. Leave Stripe and
RustDesk disabled until their separate staging setup and test procedures are
ready. If Stripe is later tested, use Stripe test-mode credentials and a
staging-only webhook.

## Frontend environment

Configure the frontend build variable shown in
[`apps/client-web/.env.staging.example`](../apps/client-web/.env.staging.example):

- `VITE_API_URL`: the API's HTTPS origin only, for example
  `https://api-staging.example.com`

Build with `npm run build:staging` from `apps/client-web`. The build fails if
the API origin is missing, contains a path, or does not use HTTPS. Do not point
a staging or production build at localhost.

## Deploy and smoke-test

1. Deploy the API and frontend to their staging services using the variables
   above.
2. Check `https://<staging-api-host>/health` for API liveness.
3. Check `https://<staging-api-host>/ready` for database readiness.
4. Open the staging client URL and create a dedicated test account.
5. Register a test computer and verify that a support ticket can be created,
   claimed by a staging technician, and closed.
6. Confirm the browser connects only to the staging API, including its
   WebSocket connection.
7. Confirm `RUSTDESK_EXECUTE` remains `false`; do not initiate a real remote
   session during these smoke tests.
8. Delete test accounts and records according to the staging retention policy.

Do not connect production data, invite real customers, or enable live billing
until backups, restore procedures, monitoring, access control, and a rollback
plan have been validated.
