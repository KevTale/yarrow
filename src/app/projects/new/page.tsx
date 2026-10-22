import type { Metadata } from "next";
import { PageHeading, DemoNotice } from "@/components/ui";
import { ProjectForm } from "@/components/project-form";

export const metadata: Metadata = { title: "Add a project" };
export default function NewProjectPage() {
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="Add a project"
        title="Give your backlog a hand."
        description="Bring the issues. Set the limits. Review what comes back."
      />
      <DemoNotice>
        Project setup preview · GitHub App and Jira OAuth are not connected.
      </DemoNotice>
      <ProjectForm />
    </main>
  );
}
