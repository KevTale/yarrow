import { Ticket } from "lucide-react";
import { Spinner } from "@/components/navigation-feedback";

/**
 * The ticket written: the go-ahead under the agent's words, as the chat's
 * ticket card is, on the landing, whose dialog has no buttons of its own.
 */
export function TicketReady({
  title,
  label,
  busy = false,
  onGo,
}: {
  title: string;
  label: string;
  busy?: boolean;
  onGo: () => void;
}) {
  return (
    <div className="pp-proposal">
      <div className="pp-proposal-head">
        <Ticket size={15} aria-hidden="true" />
        Ticket
      </div>
      <p className="pp-proposal-title">{title}</p>
      <div className="pp-proposal-foot">
        <button
          type="button"
          className="pp-send"
          aria-disabled={busy}
          onClick={onGo}
        >
          {label} {busy && <Spinner />}
        </button>
      </div>
    </div>
  );
}
