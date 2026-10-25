import { useServerFn } from "@tanstack/react-start";
import { Github } from "lucide-react";
import { useState, type FormEvent } from "react";
import { sendSignInLinkFn } from "@/functions/viewer.functions";

/**
 * The sign-in page: GitHub for builders (it also connects their repos), a
 * one-time email link for sponsors, on any device.
 */
export function SignInPrompt({
  next,
  error,
}: {
  next: string;
  error?: string;
}) {
  return (
    <main id="main" className="container signin">
      <div className="signin-inner">
        <h1>Sign in</h1>
        {error && (
          <p className="signin-error" role="alert">
            {error}
          </p>
        )}
        <a
          className="signin-github"
          href={`/auth/github?next=${encodeURIComponent(next)}`}
        >
          <Github size={17} /> Continue with GitHub
        </a>
        <p className="signin-or">or</p>
        <EmailSignIn next={next} />
      </div>
    </main>
  );
}

function EmailSignIn({ next }: { next: string }) {
  const send = useServerFn(sendSignInLinkFn);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    try {
      await send({ data: { email: email.trim(), next } });
      setState("sent");
    } catch {
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <div className="signin-sent" role="status">
        <b>Check your inbox</b>
        <span>
          A sign-in link is on its way to <span className="mono">{email}</span>
        </span>
        <button type="button" onClick={() => setState("idle")}>
          Use another email
        </button>
      </div>
    );
  return (
    <form className="signin-email" onSubmit={submit}>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        aria-label="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {state === "error" && (
        <p className="signin-error" role="alert">
          The link could not be sent. Try again in a minute.
        </p>
      )}
    </form>
  );
}
