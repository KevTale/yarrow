import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { adoptSessionFn } from "@/functions/viewer.functions";

/** Picks up a session left in the URL fragment by an email sign-in link. */
export function SessionFromLink() {
  const router = useRouter();
  const adopt = useServerFn(adoptSessionFn);
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const failure = hash.get("error_description");
    if (!accessToken && !failure) return;
    // Tokens never stay in the address bar or the history.
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    if (failure || !refreshToken) {
      window.location.assign(
        `/sign-in?error=${encodeURIComponent(failure ?? "This link has expired")}`,
      );
      return;
    }
    adopt({ data: { accessToken: accessToken!, refreshToken } })
      .then(() => router.invalidate())
      .catch(() =>
        window.location.assign("/sign-in?error=This%20link%20has%20expired"),
      );
  }, [adopt, router]);
  return null;
}
