import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Brand } from "@/components/site-header";

export const metadata: Metadata = {
  title: "One account, two ways to contribute",
};
export default function SignInPage() {
  return (
    <main id="main" className="container page-main">
      <div className="sign-in-card">
        <Brand />
        <h1>
          One account.
          <br />
          More good work.
        </h1>
        <p>
          Fund AI work, add your projects, and follow every contribution from
          credit to outcome.
        </p>
        <div className="info-box">
          Authentication is not connected in this MVP preview. Explore a sample
          workspace without sharing credentials.
        </div>
        <Link href="/dashboard" className="button button-primary button-full">
          Explore the demo workspace <ArrowRight size={16} />
        </Link>
        <p className="small">
          The same account will give you both actions:{" "}
          <Link className="amber" href="/fund">
            Fund AI work
          </Link>{" "}
          and{" "}
          <Link className="amber" href="/projects/new">
            Add a project
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
