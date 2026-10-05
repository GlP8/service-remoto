# API

## Tests

Run the unit tests with:

```sh
npm run test:unit
```

The full test command also runs integration tests against PostgreSQL:

```sh
npm test
```

Before running `npm test` locally, set `TEST_DATABASE_URL` to a **disposable**
PostgreSQL database whose name ends in `_test`, for example:

```text
postgresql://user:password@localhost:5432/service_remoto_test
```

The integration suite drops and recreates the tables in that database. It
refuses to run when the database name does not end in `_test`. Never point
`TEST_DATABASE_URL` at a development, staging, or production database.
GitHub Actions provides a fresh PostgreSQL test database automatically.
