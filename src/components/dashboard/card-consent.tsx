import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { acceptCardFn } from "@/functions/builder.functions";
import { Modal, ModalHead, PrSketch } from "../sponsor-board";

/**
 * Once, on the first Builder visit: the sponsors' card closes every pull
 * request Yarrow opens. "Got it" records the consent (Terms, Builders);
 * closing without it asks again next time.
 */
export function CardConsent() {
  const accept = useServerFn(acceptCardFn);
  const [open, setOpen] = useState(true);
  const close = () => setOpen(false);
  return (
    <Modal open={open} onClose={close} labelledBy="consent-title" wide>
      <div className="sb-dialog-body">
        <ModalHead
          id="consent-title"
          title="Your pull requests carry their sponsors' card"
          onClose={close}
        />
        <div className="consent-body">
          <p>
            Sponsors pay for the agents that write your pull requests, so every
            pull request ends with their card. It keeps Yarrow free for you and
            cannot be removed. See the{" "}
            <a href="/terms" target="_blank">
              Terms
            </a>
            .
          </p>
          <PrSketch
            sponsor={{
              name: "Northbeam Cloud",
              description: "Managed Postgres with branching and restore.",
              site: "northbeam.cloud",
              logo: null,
            }}
          />
          <button
            type="button"
            className="sb-claim-go sb-dialog-pay"
            onClick={() => {
              close();
              void accept();
            }}
          >
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
}
