# Tally

A small team task list: sign in, see the team's tasks, add one, change your settings.

## Run it

Requirements: Node 22 or later, PostgreSQL 14 or later.

```bash
cp .env.example .env      # then point DATABASE_URL at your database
npm install
npm run db:migrate
npm run db:seed           # demo team, tasks and the demo user
npm start                 # http://localhost:3000
```

Sign in as `demo@tally.dev` with the password `demo1234`.

## Test

```bash
npm test
```

## Layout

- `src/server.js`: routes (pages and `/api/tasks`).
- `src/views.js`: the HTML of each page.
- `src/auth.js`: passwords and the signed session cookie.
- `src/db.js`: queries.
- `db/schema.sql`: tables. `scripts/seed.js`: demo data.
- `public/style.css`: styles.
