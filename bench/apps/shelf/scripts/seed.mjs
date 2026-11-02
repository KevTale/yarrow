import pg from "pg";

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the environment is set another way.
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// 60 products, the same every time.
const kinds = {
  Kitchen: ["Mug", "Teapot", "Chef knife", "Cutting board", "Pour-over kettle"],
  Desk: ["Notebook", "Fountain pen", "Desk lamp", "Monitor stand", "Pen tray"],
  Outdoors: ["Water bottle", "Daypack", "Headlamp", "Camp stool", "Rain shell"],
  Home: ["Throw blanket", "Candle", "Plant pot", "Doormat", "Wall clock"],
};
const finishes = ["Oak", "Slate", "Linen"];
await pool.query("TRUNCATE products RESTART IDENTITY");
let index = 0;
for (const finish of finishes)
  for (const [category, names] of Object.entries(kinds))
    for (const name of names) {
      index++;
      await pool.query(
        "INSERT INTO products (name, category, price_cents, description, stock) VALUES ($1, $2, $3, $4, $5)",
        [
          `${finish} ${name.toLowerCase()}`,
          category,
          900 + ((index * 1373) % 11000),
          `A ${name.toLowerCase()} in ${finish.toLowerCase()}, made to last and easy to love.`,
          (index * 7) % 25,
        ],
      );
    }
await pool.end();
console.log(`Seeded ${index} products`);
