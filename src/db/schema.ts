import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  check,
  unique,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const visibilityEnum = pgEnum("visibility", [
  "public",
  "listed",
  "hidden",
]);
export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);
export const sponsorModeEnum = pgEnum("sponsor_mode", ["all_except", "only"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "settled",
  "refunded",
]);
export const creditSourceEnum = pgEnum("credit_source", ["stripe", "promo"]);
export const trackerEnum = pgEnum("tracker", [
  "github",
  "linear",
  "jira",
  "trello",
]);
export const workStatusEnum = pgEnum("work_status", [
  "queued",
  "running",
  "delivered",
  "abstained",
  "closed",
]);
export const runKindEnum = pgEnum("run_kind", ["implementation", "correction"]);
export const runStatusEnum = pgEnum("run_status", [
  "running",
  "completed",
  "abstained",
]);
export const outcomeEnum = pgEnum("outcome", ["pull_request", "abstained"]);
export const pullRequestStateEnum = pgEnum("pull_request_state", [
  "open",
  "merged",
  "closed",
]);
export const ledgerKindEnum = pgEnum("ledger_kind", [
  "credit",
  "reserve",
  "debit",
  "release",
]);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

/** An organization. Fair-share rotation is per account, never per project. */
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
}).enableRLS();

export const accountMembers = pgTable(
  "account_members",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    userId: uuid("user_id").notNull(), // Supabase auth user ID (GitHub login).
    role: memberRoleEnum("role").default("member").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.userId] })],
).enableRLS();

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    description: text("description").default("").notNull(),
    productUrl: text("product_url"),
    visibility: visibilityEnum("visibility").default("listed").notNull(),
    categories: text("categories")
      .array()
      .default(sql`'{}'`)
      .notNull(),
    stacks: text("stacks")
      .array()
      .default(sql`'{}'`)
      .notNull(),
    repository: text("repository").notNull(), // owner/name on GitHub.
    githubInstallationId: text("github_installation_id"),
    authorizationLabel: text("authorization_label")
      .default("agent-commons")
      .notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_repository").on(t.repository),
    index("projects_account").on(t.accountId),
  ],
).enableRLS();

/** How to run the app in the provider sandbox, for screenshots and video. Optional. */
export const projectRunConfigs = pgTable("project_run_configs", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id),
  setupCommand: text("setup_command"),
  seedCommand: text("seed_command"),
  startCommand: text("start_command"),
  appPort: integer("app_port"),
  // Non-secret development variables only. Secrets live in project_secrets.
  env: jsonb("env").$type<Record<string, string>>().default({}).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

/**
 * Test or staging secrets. Values are never stored here: they are written once
 * to the implementing provider's vault and only the credential reference is kept.
 */
export const projectSecrets = pgTable(
  "project_secrets",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    providerCredentialId: text("provider_credential_id").notNull(),
    allowedHost: text("allowed_host").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.name] }),
    check("secret_name", sql`${t.name} ~ '^[A-Z_][A-Z0-9_]*$'`),
  ],
).enableRLS();

/** One row per sponsor. Missing row means the defaults: all_except, no hidden projects. */
export const sponsorProfiles = pgTable("sponsor_profiles", {
  userId: uuid("user_id").primaryKey(),
  publicName: text("public_name"), // NULL means anonymous, never expose userId.
  mode: sponsorModeEnum("mode").default("all_except").notNull(),
  includeHidden: boolean("include_hidden").default(false).notNull(),
  excludedCategories: text("excluded_categories")
    .array()
    .default(sql`'{}'`)
    .notNull(),
  // Empty means any stack; otherwise the project must use at least one of them.
  requiredStacks: text("required_stacks")
    .array()
    .default(sql`'{}'`)
    .notNull(),
  foundingSponsor: boolean("founding_sponsor").default(false).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
}).enableRLS();

/** Excluded projects in all_except mode, selected projects in only mode. */
export const sponsorProjectSelections = pgTable(
  "sponsor_project_selections",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => sponsorProfiles.userId),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
).enableRLS();

export const contributions = pgTable(
  "contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    source: creditSourceEnum("source").default("stripe").notNull(),
    paymentStatus: paymentStatusEnum("payment_status")
      .default("pending")
      .notNull(),
    stripeCheckoutId: text("stripe_checkout_id").unique(),
    // amount = tax + Stripe fee + margin + credit (credit is the remainder).
    amountCents: integer("amount_cents").notNull(),
    taxCents: integer("tax_cents").default(0).notNull(),
    feeCents: integer("fee_cents").default(0).notNull(),
    marginCents: integer("margin_cents").default(0).notNull(),
    creditCents: integer("credit_cents").notNull(),
    reservedCents: integer("reserved_cents").default(0).notNull(),
    debitedCents: integer("debited_cents").default(0).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "valid_credit",
      sql`${t.amountCents} >= 0 AND ${t.taxCents} >= 0 AND ${t.feeCents} >= 0 AND ${t.marginCents} >= 0 AND ${t.creditCents} >= 0 AND ${t.reservedCents} >= 0 AND ${t.debitedCents} >= 0 AND ${t.reservedCents} + ${t.debitedCents} <= ${t.creditCents}`,
    ),
    check(
      "stripe_breakdown",
      sql`${t.source} <> 'stripe' OR ${t.taxCents} + ${t.feeCents} + ${t.marginCents} + ${t.creditCents} <= ${t.amountCents}`,
    ),
    check(
      "settled_before_spend",
      sql`${t.paymentStatus} = 'settled' OR (${t.reservedCents} = 0 AND ${t.debitedCents} = 0)`,
    ),
    index("contributions_user").on(t.userId),
    index("contributions_spendable").on(t.paymentStatus, t.createdAt),
  ],
).enableRLS();

export const workUnits = pgTable(
  "work_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    source: trackerEnum("source").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    authorized: boolean("authorized").default(false).notNull(),
    status: workStatusEnum("status").default("queued").notNull(),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("work_unit_external").on(t.projectId, t.source, t.externalId),
    index("work_units_queue").on(t.status, t.queuedAt),
  ],
).enableRLS();

/** One PR per work unit. Correction runs update the same PR. */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workUnitId: uuid("work_unit_id")
      .notNull()
      .unique()
      .references(() => workUnits.id),
    url: text("url").notNull().unique(),
    state: pullRequestStateEnum("state").default("open").notNull(),
    rejectionReason: text("rejection_reason"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "pull_request_closure",
      sql`(${t.state} = 'open') = (${t.closedAt} IS NULL)`,
    ),
  ],
).enableRLS();

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey(), // Supplied by the queue producer; stable across retries.
    workUnitId: uuid("work_unit_id")
      .notNull()
      .references(() => workUnits.id),
    kind: runKindEnum("kind").default("implementation").notNull(),
    // The correction request text, posted by the owner on the PR.
    instruction: text("instruction"),
    status: runStatusEnum("status").default("running").notNull(),
    reservedCents: integer("reserved_cents").default(0).notNull(), // Total, kept for audit.
    debitedCents: integer("debited_cents").default(0).notNull(),
    // Actual cost beyond every reservation. There is no cap: the platform absorbs it.
    uncoveredCents: integer("uncovered_cents").default(0).notNull(),
    implementer: text("implementer").notNull(),
    reviewer: text("reviewer").notNull(),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "run_money",
      sql`${t.reservedCents} >= 0 AND ${t.debitedCents} >= 0 AND ${t.uncoveredCents} >= 0 AND ${t.debitedCents} <= ${t.reservedCents}`,
    ),
    check(
      "correction_instruction",
      sql`(${t.kind} = 'correction') = (${t.instruction} IS NOT NULL)`,
    ),
    index("runs_per_work_unit").on(t.workUnitId),
    index("runs_status").on(t.status),
  ],
).enableRLS();

/** A run can be funded by several contributions, oldest money first. */
export const runFundings = pgTable(
  "run_fundings",
  {
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id),
    reservedCents: integer("reserved_cents").default(0).notNull(),
    debitedCents: integer("debited_cents").default(0).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.agentRunId, t.contributionId] }),
    check(
      "funding_money",
      sql`${t.reservedCents} >= 0 AND ${t.debitedCents} >= 0 AND ${t.debitedCents} <= ${t.reservedCents}`,
    ),
    index("fundings_contribution").on(t.contributionId),
  ],
).enableRLS();

export const results = pgTable(
  "results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .unique()
      .references(() => agentRuns.id),
    outcome: outcomeEnum("outcome").notNull(),
    summary: text("summary").notNull(),
    pullRequestUrl: text("pull_request_url"),
    abstentionReason: text("abstention_reason"),
    evidence: jsonb("evidence").$type<string[]>().default([]).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "outcome_evidence",
      sql`(${t.outcome} = 'pull_request' AND ${t.pullRequestUrl} IS NOT NULL AND ${t.abstentionReason} IS NULL) OR (${t.outcome} = 'abstained' AND ${t.abstentionReason} IS NOT NULL AND ${t.pullRequestUrl} IS NULL)`,
    ),
  ],
).enableRLS();

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    kind: ledgerKindEnum("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check("ledger_nonnegative", sql`${t.amountCents} >= 0`),
    index("ledger_contribution").on(t.contributionId),
    index("ledger_run").on(t.agentRunId),
  ],
).enableRLS();

/** Append-only metrics log. Every meaningful action writes one row. */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    accountId: uuid("account_id"),
    projectId: uuid("project_id"),
    userId: uuid("user_id"),
    workUnitId: uuid("work_unit_id"),
    agentRunId: uuid("agent_run_id"),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("event_type", sql`${t.type} ~ '^[a-z_]+(\\.[a-z_]+)+$'`),
    index("events_type_time").on(t.type, t.createdAt),
  ],
).enableRLS();
