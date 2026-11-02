import pg from "pg";

const cached = globalThis as unknown as { pool?: pg.Pool };
export const pool = (cached.pool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL,
}));

export interface Product {
  id: number;
  name: string;
  category: string;
  priceCents: number;
  description: string;
  stock: number;
}

const COLUMNS = `id, name, category, price_cents AS "priceCents", description, stock`;

/** Every product, newest first. */
export async function listProducts(): Promise<Product[]> {
  const { rows } = await pool.query<Product>(
    `SELECT ${COLUMNS} FROM products ORDER BY id DESC`,
  );
  return rows;
}

export async function getProduct(id: number): Promise<Product | null> {
  const { rows } = await pool.query<Product>(
    `SELECT ${COLUMNS} FROM products WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export const price = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
