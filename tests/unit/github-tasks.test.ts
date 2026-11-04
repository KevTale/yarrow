import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import {
  MAX_GITHUB_TASK_ATTEMPTS,
  pendingGithubTasks,
  projectsForUser,
  requestGithubTask,
  requestTicket,
} from "../../src/db/github-tasks";
import { importProject } from "../../src/db/projects";
import { ownerDashboard } from "../../src/db/queries";
import * as schema from "../../src/db/schema";
import { syncInstallation } from "../../src/server/github/installation";
import { runGithubTasks } from "../../src/server/github/tasks";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const marie = { userId: crypto.randomUUID(), githubLogin: "Marie", name: null };
const credentials = {
  appId: "1",
  privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
};

type Repository = { id: number; full_name: string; private: boolean };
const install = (login: string, repositories: Repository[]) => ({
  action: "created",
  sender: { login },
  installation: { id: 42 },
  repositories,
});
const halyard = { id: 999, full_name: "marie/halyard", private: false };
const vault = { id: 1000, full_name: "marie/vault", private: true };

/** A fake GitHub for the brain's setup and labeling calls. */
function fakeGitHub(options: { labelExists?: boolean; fail?: boolean } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.github.com", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? "GET", path, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (path.endsWith("/access_tokens"))
      return json({ token: "t", expires_at: "2030-01-01T00:00:00Z" }, 201);
    if (options.fail) return json({ message: "Server error" }, 502);
    if (path.endsWith("/languages"))
      return json({ "Jupyter Notebook": 10, TypeScript: 900, CSS: 50 });
    if (path.endsWith("/labels") && path.split("/").length === 5)
      return options.labelExists
        ? json({ message: "already_exists" }, 422)
        : json({}, 201);
    if (path.startsWith("/repos/") && init.method === "GET")
      return json({
        description: "Sail tracking",
        homepage: "https://halyard.app",
        default_branch: "trunk",
      });
    return json([], 200);
  }) as typeof fetch;
  return { fetcher, calls };
}

/** What the setup does with the repository it was given. */
async function installed(repositories: Repository[]) {
  await handleGitHubEvent(db, "installation", install("marie", repositories));
  const projects = await projectsForUser(db, marie.userId);
  for (const project of projects)
    await importProject(db, project.id, marie.userId);
}

afterAll(() => t.pg.close());
beforeEach(async () => {
  await t.reset();
});

describe("projects from a GitHub install", () => {
  it("creates one project per new repository, in the installer's account", async () => {
    await ensureAccount(db, marie);
    expect(
      await handleGitHubEvent(
        db,
        "installation",
        install("mallory", [halyard]),
      ),
    ).toBe("installation linked 0 project(s), created 0");
    expect(
      await handleGitHubEvent(
        db,
        "installation",
        install("marie", [halyard, vault]),
      ),
    ).toBe("installation linked 0 project(s), created 2");
    const projects = await projectsForUser(db, marie.userId);
    expect(
      projects
        .map(({ name, visibility, linked }) => ({ name, visibility, linked }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ).toEqual([
      { name: "halyard", visibility: "public", linked: true },
      { name: "vault", visibility: "listed", linked: true },
    ]);
    // Nothing touches a repository before it is imported.
    expect(await pendingGithubTasks(db)).toHaveLength(0);
    // Installing again (or adding the same repo) creates nothing new.
    await handleGitHubEvent(db, "installation_repositories", {
      action: "added",
      sender: { login: "marie" },
      installation: { id: 42 },
      repositories_added: [halyard],
    });
    expect(await projectsForUser(db, marie.userId)).toHaveLength(2);
  });

  it("unlinks the repositories GitHub no longer lists for the installation", async () => {
    await ensureAccount(db, marie);
    await handleGitHubEvent(
      db,
      "installation",
      install("marie", [halyard, vault]),
    );
    const listing = (status: number, ids: number[]) =>
      (async (url: string) =>
        url.endsWith("/access_tokens")
          ? new Response(
              JSON.stringify({
                token: "t",
                expires_at: "2030-01-01T00:00:00Z",
              }),
              { status: status === 404 ? 404 : 201 },
            )
          : new Response(
              JSON.stringify({ repositories: ids.map((id) => ({ id })) }),
            )) as typeof fetch;
    const linked = async () =>
      (await projectsForUser(db, marie.userId))
        .filter((project) => project.linked)
        .map((project) => project.name);

    expect(
      await syncInstallation(db, credentials, "42", listing(200, [vault.id])),
    ).toBe(1);
    expect(await linked()).toEqual(["vault"]);
    // Uninstalled without a word: GitHub no longer knows it.
    expect(
      await syncInstallation(db, credentials, "42", listing(404, [])),
    ).toBe(1);
    expect(await linked()).toEqual([]);
  });

  it("shows and sets up only the repository imported, however many came", async () => {
    await ensureAccount(db, marie);
    await handleGitHubEvent(
      db,
      "installation",
      install("marie", [halyard, vault]),
    );
    const projects = await projectsForUser(db, marie.userId);
    expect(projects.map((project) => project.imported)).toEqual([false, false]);
    expect((await ownerDashboard(db, marie.userId)).projects).toEqual([]);

    const chosen = projects.find((project) => project.name === "vault")!;
    await importProject(db, chosen.id, marie.userId);
    await importProject(db, chosen.id, marie.userId);
    const shown = (await ownerDashboard(db, marie.userId)).projects;
    expect(shown.map((project) => project.name)).toEqual(["vault"]);
    expect(await pendingGithubTasks(db)).toHaveLength(1);

    // A ticket on a repository left out is not a ticket of Yarrow's.
    const left = (await projectsForUser(db, marie.userId)).find(
      (project) => !project.imported,
    )!;
    expect(
      await requestTicket(db, marie.userId, left.repository, 5),
    ).toBeNull();
  });

  it("never takes a repository listed by another account", async () => {
    await ensureAccount(db, marie);
    const other = {
      userId: crypto.randomUUID(),
      githubLogin: "bob",
      name: null,
    };
    await ensureAccount(db, other);
    await handleGitHubEvent(db, "installation", install("bob", [halyard]));
    await handleGitHubEvent(db, "installation", install("marie", [halyard]));
    expect(await projectsForUser(db, marie.userId)).toHaveLength(0);
  });

  it("queues a pasted ticket only on the viewer's connected repository", async () => {
    await ensureAccount(db, marie);
    await installed([halyard]);
    expect(
      await requestTicket(db, crypto.randomUUID(), "marie/halyard", 5),
    ).toBeNull();
    expect(await requestTicket(db, marie.userId, "Marie/Halyard", 5)).toEqual(
      expect.any(String),
    );
    await requestTicket(db, marie.userId, "marie/halyard", 5);
    const tasks = await pendingGithubTasks(db);
    expect(tasks.map((task) => [task.kind, task.issueNumber])).toEqual([
      ["setup_project", 0],
      ["label_issue", 5],
    ]);
  });
});

describe("GitHub tasks in the brain", () => {
  it("fills the project from the repo, creates the label, labels the ticket", async () => {
    await ensureAccount(db, marie);
    await installed([halyard]);
    await requestTicket(db, marie.userId, "marie/halyard", 5);
    const github = fakeGitHub({ labelExists: true });

    expect(await runGithubTasks(db, credentials, github.fetcher)).toEqual([
      "setup_project marie/halyard done",
      "label_issue marie/halyard done",
    ]);
    const [project] = await raw.select().from(schema.projects);
    expect(project).toMatchObject({
      description: "Sail tracking",
      productUrl: "https://halyard.app",
      defaultBranch: "trunk",
      stacks: ["typescript", "css", "jupyter-notebook"],
    });
    const token = github.calls.find((call) =>
      call.path.endsWith("/access_tokens"),
    );
    expect(token!.body).toEqual({ repository_ids: [999] });
    expect(
      github.calls.filter((call) => call.method === "POST").map((c) => c.path),
    ).toEqual([
      "/app/installations/42/access_tokens",
      "/repos/marie/halyard/labels",
      "/app/installations/42/access_tokens",
      "/repos/marie/halyard/issues/5/labels",
    ]);
    expect(github.calls.at(-1)!.body).toEqual({ labels: ["yarrow"] });
    expect(await pendingGithubTasks(db)).toHaveLength(0);
    expect(await runGithubTasks(db, credentials, github.fetcher)).toEqual([]);
  });

  it("keeps the owner's edits", async () => {
    await ensureAccount(db, marie);
    await handleGitHubEvent(db, "installation", install("marie", [halyard]));
    await raw
      .update(schema.projects)
      .set({ description: "Mine", stacks: ["rust"] });
    await runGithubTasks(db, credentials, fakeGitHub().fetcher);
    const [project] = await raw.select().from(schema.projects);
    expect(project).toMatchObject({ description: "Mine", stacks: ["rust"] });
  });

  it("retries a failing task, then leaves it with its error", async () => {
    await ensureAccount(db, marie);
    await installed([halyard]);
    const github = fakeGitHub({ fail: true });
    for (let i = 0; i < MAX_GITHUB_TASK_ATTEMPTS + 1; i++)
      await runGithubTasks(db, credentials, github.fetcher);
    const [task] = await raw.select().from(schema.githubTasks);
    expect(task).toMatchObject({
      attempts: MAX_GITHUB_TASK_ATTEMPTS,
      doneAt: null,
    });
    expect(task!.lastError).toContain("502");
    // Asking again gives it a fresh start.
    const project = (await projectsForUser(db, marie.userId))[0]!;
    await requestGithubTask(db, {
      projectId: project.id,
      kind: "setup_project",
    });
    expect(await pendingGithubTasks(db)).toHaveLength(1);
  });
});
