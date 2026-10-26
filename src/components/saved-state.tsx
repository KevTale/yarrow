import { Check } from "lucide-react";
import { useEffect } from "react";
import { Spinner } from "@/components/navigation-feedback";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** "Saved" fades out after a moment. */
export function useSavedFades(state: SaveState, set: (next: SaveState) => void) {
  useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => set("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state, set]);
}

export function SavedState({ state }: { state: SaveState }) {
  return (
    <span className={`st-saved ${state}`} role="status">
      {state === "saving" && <Spinner />}
      {state === "saved" && (
        <>
          <Check size={13} /> Saved
        </>
      )}
      {state === "error" && "Not saved, try again"}
    </span>
  );
}
