import { categories, type ProjectForm } from "@/core/forms";
import { capitalize } from "./ui";

export const emptyProject: ProjectForm = {
  name: "",
  description: "",
  productUrl: "",
  repository: "",
  visibility: "listed",
  categories: [],
  stacks: [],
  authorizationLabel: "yarrow",
};

const visibilities = [
  {
    value: "public",
    title: "Public",
    detail: "Open source: code, tickets and PRs are visible to everyone.",
  },
  {
    value: "listed",
    title: "Listed",
    detail: "Your product's name, description and URL appear. No code, no PR.",
  },
  {
    value: "hidden",
    title: "Hidden",
    detail:
      "Nothing appears in public. Only sponsors who accept hidden projects fund it, so expect less compute.",
  },
] as const;

/** The project fields shared by creation and settings. */
export function ProjectFields({
  value,
  onChange,
  stacksText,
  onStacksText,
}: {
  value: ProjectForm;
  onChange: (patch: Partial<ProjectForm>) => void;
  stacksText: string;
  onStacksText: (text: string) => void;
}) {
  return (
    <>
      <fieldset className="form-section">
        <legend className="eyebrow">01 / The project</legend>
        <div className="field-grid">
          <label className="field">
            GitHub repository
            <input
              required
              value={value.repository}
              placeholder="owner/repository"
              onChange={(event) => onChange({ repository: event.target.value })}
            />
          </label>
        </div>
        <label className="field">
          Description
          <textarea
            value={value.description}
            maxLength={500}
            rows={3}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </label>
        <label className="field">
          Product URL (optional)
          <input
            type="url"
            value={value.productUrl}
            placeholder="https://"
            onChange={(event) => onChange({ productUrl: event.target.value })}
          />
        </label>
      </fieldset>

      <fieldset className="form-section">
        <legend className="eyebrow">02 / Visibility</legend>
        <div className="choice-list">
          {visibilities.map((option) => (
            <label className="choice-row" key={option.value}>
              <input
                type="radio"
                checked={value.visibility === option.value}
                onChange={() => onChange({ visibility: option.value })}
              />
              <span>
                <strong>{option.title}</strong>
                <small>{option.detail}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="field-note">
          Whatever you choose, sponsors and the platform never see your code:
          only the AI providers process it, through their API, in a sandbox
          destroyed after each run.
        </p>
      </fieldset>

      <fieldset className="form-section">
        <legend className="eyebrow">03 / Category and stack</legend>
        <p className="field-note">
          Sponsors use these to choose what they fund. Pick 1 to 5 categories.
        </p>
        <div className="type-grid">
          {categories.map((category) => (
            <label className="checkbox-row" key={category}>
              <input
                type="checkbox"
                checked={value.categories.includes(category)}
                onChange={(event) =>
                  onChange({
                    categories: event.target.checked
                      ? [...value.categories, category]
                      : value.categories.filter((item) => item !== category),
                  })
                }
              />
              <span>{capitalize(category)}</span>
            </label>
          ))}
        </div>
        <label className="field">
          Stack (comma-separated)
          <input
            value={stacksText}
            placeholder="nextjs, supabase, stripe"
            onChange={(event) => onStacksText(event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset className="form-section">
        <legend className="eyebrow">04 / Authorization label</legend>
        <label className="field">
          Only tickets carrying this label are worked on
          <input
            required
            value={value.authorizationLabel}
            maxLength={50}
            onChange={(event) =>
              onChange({ authorizationLabel: event.target.value })
            }
          />
        </label>
      </fieldset>
    </>
  );
}

export function parseStacks(text: string): string[] {
  return text
    .split(",")
    .map((stack) => stack.trim().toLowerCase())
    .filter(Boolean);
}
