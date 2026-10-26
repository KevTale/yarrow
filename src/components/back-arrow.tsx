import { Link, useCanGoBack, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/** Back where the visitor came from; home when the page was opened first. */
export function BackArrow({ size = 18 }: { size?: number }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return canGoBack ? (
    <button
      type="button"
      className="st-back"
      aria-label="Back"
      onClick={() => router.history.back()}
    >
      <ArrowLeft size={size} />
    </button>
  ) : (
    <Link to="/" className="st-back" aria-label="Home">
      <ArrowLeft size={size} />
    </Link>
  );
}
