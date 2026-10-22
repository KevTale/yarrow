"use client";

import { useSyncExternalStore } from "react";
import type { ProjectDraft } from "@/core/forms";
import { projectSchema } from "@/core/forms";

const key = "agent-commons.demo-projects.v1";
const eventName = "agent-commons:demo-projects";
const emptySnapshot = "[]";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(eventName, callback);
  };
}
function snapshot(): string {
  try {
    return localStorage.getItem(key) ?? emptySnapshot;
  } catch {
    return emptySnapshot;
  }
}
function parse(raw: string): ProjectDraft[] {
  try {
    return projectSchema.array().parse(JSON.parse(raw));
  } catch {
    return [];
  }
}
export function saveDemoProject(project: ProjectDraft): void {
  const projects = parse(snapshot()).filter(
    (p) => p.repository !== project.repository,
  );
  localStorage.setItem(key, JSON.stringify([...projects, project].slice(-20)));
  window.dispatchEvent(new Event(eventName));
}
export function useDemoProjects(): ProjectDraft[] {
  return parse(useSyncExternalStore(subscribe, snapshot, () => emptySnapshot));
}
