import { useServerFn } from "@tanstack/react-start";
import { GitMerge } from "lucide-react";
import { useState } from "react";
import { pullRequestActionFn } from "@/functions/builder.functions";
import { SlideGo } from "./slide-go";

/**
 * Merge, like Start and Retry: slid to the end, it merges (ready first when
 * it is a draft). On the row's line, and where a demo ends. Hidden while a
 * change asked is at work, since its commit would be left out.
 */
export function MergeGo({
  rowKey,
  projectId,
  onChanged,
}: {
  rowKey: string;
  projectId: string;
  onChanged: () => void;
}) {
  const merge = useServerFn(pullRequestActionFn);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    if (merging) return;
    setError("");
    setMerging(true);
    try {
      const result = await merge({
        data: { projectId, key: rowKey, action: "merge" },
      });
      if (result.ok) onChanged();
      else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setMerging(false);
    }
  }
  return (
    <>
      {error && (
        <span className="tix-state stopped" title={error}>
          Not merged
        </span>
      )}
      <SlideGo
        label="Merge"
        tone="green"
        icon={<GitMerge size={12} aria-hidden="true" />}
        busy={merging}
        onGo={go}
      />
    </>
  );
}
