import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { sendSignInLinkFn } from "@/functions/viewer.functions";

/** Sign in without GitHub: a one-time link by email. */
export function EmailSignIn({ next }: { next: string }) {
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
      <p className="feedback" role="status">
        Check {email.trim()} for your sign-in link.
      </p>
    );
  return (
    <form className="email-sign-in" onSubmit={submit}>
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        aria-label="Email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button
        className="button button-secondary"
        disabled={state === "sending"}
      >
        {state === "sending" ? "Sending…" : "Email me a link"}
      </button>
      {state === "error" && (
        <p className="feedback feedback-error" role="alert">
          The link could not be sent. Try again in a minute.
        </p>
      )}
    </form>
  );
}
