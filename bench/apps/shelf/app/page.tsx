import Link from "next/link";
import { listProducts, price } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const products = await listProducts();
  return (
    <>
      <div className="head">
        <h1>All products</h1>
        <p className="muted">{products.length} products</p>
      </div>
      <ul className="grid">
        {products.map((product) => (
          <li key={product.id}>
            <Link href={`/products/${product.id}`} className="card">
              <span className="swatch" data-category={product.category} />
              <span className="name">{product.name}</span>
              <span className="muted">{product.category}</span>
              <span className="price">{price(product.priceCents)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
