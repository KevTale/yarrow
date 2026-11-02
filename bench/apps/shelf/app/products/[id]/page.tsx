import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct, price } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = Number.isInteger(Number(id))
    ? await getProduct(Number(id))
    : null;
  if (!product) notFound();
  return (
    <article className="product">
      <Link href="/" className="muted">
        ← All products
      </Link>
      <span className="swatch big" data-category={product.category} />
      <h1>{product.name}</h1>
      <p className="price">{price(product.priceCents)}</p>
      <p>{product.description}</p>
      <p className="muted">
        {product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}
      </p>
    </article>
  );
}
