import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Github } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { Spinner } from "@/components/navigation-feedback";
import { PrSketch } from "@/components/sponsor-board";
import { acceptTermsFn } from "@/functions/builder.functions";

/**
 * Between signing in with GitHub and installing the App, once per version
 * of the Terms: the builder ticks them, the sponsors' card at the foot of
 * every pull request named, then goes on to GitHub (`/connect/github`
 * sends them here and back).
 */
export const Route = createFileRoute("/connect/terms")({
  validateSearch: z.object({
    next: z
      .string()
      .refine((next) => next.startsWith("/connect/github"))
      .catch("/connect/github"),
  }),
  head: () => ({ meta: [{ title: "Connect GitHub · Yarrow" }] }),
  component: ConnectTerms,
});

function ConnectTerms() {
  const { next } = Route.useSearch();
  const accept = useServerFn(acceptTermsFn);
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    if (!agreed || pending) return;
    setError("");
    setPending(true);
    try {
      await accept();
      window.location.assign(next);
    } catch {
      setError("That did not go through. Try again.");
      setPending(false);
    }
  }

  return (
    <main id="main" className="container connect-terms">
      <div className="connect-terms-inner">
        <h1>Connect GitHub</h1>
        <p className="connect-terms-lede">
          Frontier AI writes your pull requests for free: sponsors pay for the
          compute, and their card closes every pull request they fund.
        </p>
        <PrSketch
          sponsor={{
            name: "Northbeam Cloud",
            description: "Managed Postgres with branching and restore.",
            site: "northbeam.cloud",
            logo: null,
          }}
        />
        <Checkbox
          className="connect-terms-check"
          checked={agreed}
          onCheckedChange={setAgreed}
        >
          I agree to the{" "}
          <a href="/terms" target="_blank" className="sb-terms">
            Terms of Service
          </a>
          , including the sponsors&apos; card at the foot of every pull request
          Yarrow opens for me
        </Checkbox>
        <button
          type="button"
          className="signin-github"
          aria-disabled={!agreed || pending}
          onClick={() => void go()}
        >
          <Github size={17} /> Continue to GitHub
          {pending ? <Spinner /> : <ArrowRight size={15} strokeWidth={2.2} />}
        </button>
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
