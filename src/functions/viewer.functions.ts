import { createServerFn } from "@tanstack/react-start";
import { getViewer } from "@/server/auth.server";

export const getViewerFn = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      return await getViewer();
    } catch {
      // Auth outage or misconfiguration: render the public site signed out.
      return null;
    }
  },
);
