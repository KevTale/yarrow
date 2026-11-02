# Shelf

A small product catalog: Next.js (app router) and PostgreSQL.

## Run it

Node 20 or later, PostgreSQL 14 or later.

```bash
cp .env.example .env.local   # then point DATABASE_URL at your database
npm install
npm run db:migrate
npm run db:seed              # 60 products
npm run dev                  # http://localhost:3000
```

For production: `npm run build && npm start`.

## Layout

- `app/page.tsx`: the catalog. `app/products/[id]/page.tsx`: one product.
- `lib/db.ts`: queries.
- `db/migrations/`: the schema. `scripts/`: migrate and seed.
