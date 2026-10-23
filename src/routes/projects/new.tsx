import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ProjectForm } from "@/core/forms";
import { createProjectFn } from "@/functions/owner.functions";
import { getViewerFn } from "@/functions/viewer.functions";
import {
  emptyProject,
  parseStacks,
  ProjectFields,
} from "@/components/project-fields";
import { PageHeading, SignInPrompt } from "@/components/ui";

export const Route = createFileRoute("/projects/new")({
  loader: () => getViewerFn(),
  head: () => ({ meta: [{ title: "Add a project · Agent Commons" }] }),
  component: NewProjectPage,
});

function NewProjectPage() {
  const viewer = Route.useLoaderData();
  const navigate = useNavigate();
  const create = useServerFn(createProjectFn);
  const [form, setForm] = useState<ProjectForm>(emptyProject);
  const [stacks, setStacks] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!viewer)
    return (
      <main id="main" className="container page-main">
        <SignInPrompt
          next="/projects/new"
          reason="Bring your backlog. It's free."
        />
      </main>
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (form.categories.length === 0)
      return setError("Pick at least one category.");
    setPending(true);
    try {
      const { projectId } = await create({
        data: { ...form, stacks: parseStacks(stacks) },
      });
      await navigate({
        to: "/projects/$projectId",
        params: { projectId },
        search: { created: true },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the project.",
      );
      setPending(false);
    }
  }

  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="ADD A PROJECT"
        title="Your backlog, shipped by sponsored compute."
        description="Free for builders. Next step after this form: install the GitHub App on the repository, then tag tickets."
      />
      <form onSubmit={submit} className="form-layout">
        <div className="form-main">
          <ProjectFields
            value={form}
            onChange={(patch) =>
              setForm((current) => ({ ...current, ...patch }))
            }
            stacksText={stacks}
            onStacksText={setStacks}
          />
        </div>
        <aside>
          <div className="summary-card summary-content">
            <p className="eyebrow">WHAT HAPPENS NEXT</p>
            <ol className="stack small">
              <li>
                Install the Agent Commons GitHub App on{" "}
                {form.repository || "your repository"}.
              </li>
              <li>
                Tag tickets with <code>{form.authorizationLabel}</code> on
                GitHub, or connect Linear, Jira or Trello.
              </li>
              <li>Claude implements, OpenAI reviews, a draft PR arrives.</li>
              <li>
                Comment <code>@agent-commons …</code> on the PR to ask for a
                correction.
              </li>
            </ol>
            <button
              className="button button-primary button-full"
              disabled={pending}
            >
              {pending ? "Creating…" : "Create the project"}{" "}
              <ArrowRight size={16} />
            </button>
            {error && (
              <p className="feedback feedback-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </aside>
      </form>
    </main>
  );
}
