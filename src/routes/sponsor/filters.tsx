import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { categories, type SponsorFilters } from "@/core/forms";
import { getFiltersFn, saveFiltersFn } from "@/functions/sponsor.functions";
import {
  capitalize,
  NotConfigured,
  PageHeading,
  SignInPrompt,
  VisibilityBadge,
} from "@/components/ui";

export const Route = createFileRoute("/sponsor/filters")({
  loader: () => getFiltersFn(),
  head: () => ({ meta: [{ title: "Sponsor filters · Yarrow" }] }),
  component: FiltersPage,
});

function FiltersPage() {
  const data = Route.useLoaderData();
  if (data.status === "signed_out")
    return (
      <main id="main" className="container page-main">
        <SignInPrompt
          next="/sponsor/filters"
          reason="Choose where your money goes."
        />
      </main>
    );
  if (data.status === "not_configured")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );
  return <FiltersForm data={data} />;
}

function FiltersForm({
  data,
}: {
  data: Extract<Awaited<ReturnType<typeof getFiltersFn>>, { status: "ok" }>;
}) {
  const router = useRouter();
  const save = useServerFn(saveFiltersFn);
  const [filters, setFilters] = useState<SponsorFilters>(() => {
    const { foundingSponsor: _founding, ...rest } = data.filters;
    return rest;
  });
  const [stackInput, setStackInput] = useState(
    data.filters.requiredStacks.join(", "),
  );
  const [status, setStatus] = useState("");
  const selected = new Set(filters.selectedProjectIds);
  const update = (patch: Partial<SponsorFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  function toggleProject(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update({ selectedProjectIds: [...next] });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("");
    try {
      await save({
        data: {
          ...filters,
          requiredStacks: stackInput
            .split(",")
            .map((stack) => stack.trim().toLowerCase())
            .filter(Boolean),
        },
      });
      setStatus("Saved. New runs follow these filters.");
      await router.invalidate();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Could not save.");
    }
  }

  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="SPONSOR FILTERS"
        title="Where your money goes."
        description="By default your compute funds every visible project, in fair rotation. Exclude what you don't want, or deselect everything and pick projects."
      />
      <form onSubmit={submit} className="form-layout">
        <div className="form-main">
          <fieldset className="form-section">
            <legend className="eyebrow">01 / Public name</legend>
            <label className="field">
              Shown on the leaderboard and on the PRs you fund (empty =
              anonymous)
              <input
                value={filters.publicName ?? ""}
                maxLength={60}
                onChange={(event) =>
                  update({
                    publicName: event.target.value.trim()
                      ? event.target.value
                      : null,
                  })
                }
              />
            </label>
          </fieldset>

          <fieldset className="form-section">
            <legend className="eyebrow">02 / Mode</legend>
            <div className="choice-list">
              <label className="choice-row">
                <input
                  type="radio"
                  checked={filters.mode === "all_except"}
                  onChange={() =>
                    update({ mode: "all_except", selectedProjectIds: [] })
                  }
                />
                <span>
                  <strong>Every project, except…</strong>
                  <small>
                    New projects are included automatically. Check the ones to
                    exclude.
                  </small>
                </span>
              </label>
              <label className="choice-row">
                <input
                  type="radio"
                  checked={filters.mode === "only"}
                  onChange={() =>
                    update({ mode: "only", selectedProjectIds: [] })
                  }
                />
                <span>
                  <strong>Only the projects I pick</strong>
                  <small>“Deselect all”: new projects are not added.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend className="eyebrow">
              03 /{" "}
              {filters.mode === "only"
                ? "Projects to fund"
                : "Projects to exclude"}
            </legend>
            {data.projects.length === 0 ? (
              <p className="muted small">No visible project yet.</p>
            ) : (
              <div className="choice-list">
                {data.projects.map((project) => (
                  <label className="checkbox-row" key={project.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(project.id)}
                      onChange={() => toggleProject(project.id)}
                    />
                    <span>
                      <strong>{project.name}</strong>{" "}
                      <span className="muted small mono">
                        {[...project.categories, ...project.stacks].join(" · ")}
                      </span>
                    </span>
                    <VisibilityBadge visibility={project.visibility} />
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {filters.mode === "all_except" && (
            <fieldset className="form-section">
              <legend className="eyebrow">04 / Categories to exclude</legend>
              <div className="type-grid">
                {categories.map((category) => (
                  <label className="checkbox-row" key={category}>
                    <input
                      type="checkbox"
                      checked={filters.excludedCategories.includes(category)}
                      onChange={(event) =>
                        update({
                          excludedCategories: event.target.checked
                            ? [...filters.excludedCategories, category]
                            : filters.excludedCategories.filter(
                                (value) => value !== category,
                              ),
                        })
                      }
                    />
                    <span>{capitalize(category)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="form-section">
            <legend className="eyebrow">05 / Stacks and hidden projects</legend>
            <label className="field">
              Only fund projects using one of these stacks (comma-separated,
              empty = any)
              <input
                value={stackInput}
                placeholder="supabase, nextjs"
                onChange={(event) => setStackInput(event.target.value)}
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={filters.includeHidden}
                onChange={(event) =>
                  update({ includeHidden: event.target.checked })
                }
              />
              <span>
                Also fund hidden projects ({data.hiddenCount} today). You won't
                see their name or code, and their PRs won't show your name in
                public.
              </span>
            </label>
          </fieldset>
        </div>
        <aside>
          <div className="summary-card summary-content">
            <button className="button button-primary button-full">
              Save filters
            </button>
            {status && (
              <p className="feedback" role="status">
                {status}
              </p>
            )}
          </div>
        </aside>
      </form>
    </main>
  );
}
