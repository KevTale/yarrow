import { GitMerge } from "lucide-react";
import { SlideGo } from "./slide-go";

/**
 * Merge, like Start and Retry: slid to the end, it merges (ready first when
 * it is a draft). At the end of the open row's bar. Hidden while a change
 * asked is at work, since its commit would be left out. The row leaves for
 * Done as it is slid; a refusal brings it back and is said here.
 */
export function MergeGo({
  notMerged,
  onMerge,
}: {
  /** GitHub's words, when it refused. */
  notMerged?: string;
  onMerge: () => void;
}) {
  return (
    <>
      {notMerged && (
        <span className="tix-state stopped" title={notMerged}>
          Not merged
        </span>
      )}
      <SlideGo
        label="Merge"
        prompt="Slide to merge"
        tone="dark"
        icon={<GitMerge size={15} aria-hidden="true" />}
        onGo={onMerge}
      />
    </>
  );
}
