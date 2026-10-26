import { Logo, plural, SponsorName } from "@/components/boards";
import { LogoPicker } from "@/components/logo-picker";

export interface CardValue {
  anonymous: boolean;
  name: string;
  tagline: string;
  description: string;
  website: string;
  logo: string | null;
}

/**
 * The sponsor's row on the boards, edited where it shows: the card is the
 * form. `onCommit` runs when a field is left or the logo changes.
 */
export function SponsorCardRow({
  value,
  onChange,
  onCommit,
  rank,
  amount,
  clicks,
  pullRequests,
}: {
  value: CardValue;
  onChange: (patch: Partial<CardValue>) => void;
  onCommit?: (patch?: Partial<CardValue>) => void;
  rank: string;
  amount: string;
  clicks: number;
  pullRequests: number;
}) {
  const field = (key: "name" | "tagline" | "description" | "website") => ({
    value: value[key],
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange({ [key]: event.target.value }),
    onBlur: () => onCommit?.(),
  });
  return (
    <div className="board-row large first fund-row">
      <span className="board-rank">{rank}</span>
      {value.anonymous ? (
        <Logo name={null} size="large" />
      ) : (
        <LogoPicker
          name={value.name.trim()}
          value={value.logo}
          onChange={(logo) => {
            onChange({ logo });
            onCommit?.({ logo });
          }}
        />
      )}
      <span className="board-body">
        {value.anonymous ? (
          <>
            <span className="board-title">
              <SponsorName name={null} />
            </span>
            <span className="board-meta">
              <span>{plural(pullRequests, "PR")} funded</span>
            </span>
          </>
        ) : (
          <>
            <span className="board-title fund-title">
              <input
                className="fund-input fund-name"
                maxLength={60}
                size={Math.max(value.name.length, 12)}
                placeholder="Your name or company"
                aria-label="Public name"
                {...field("name")}
              />
              <span className="fund-sep" aria-hidden="true">
                ·
              </span>
              <input
                className="fund-input fund-tagline"
                maxLength={80}
                size={Math.max(value.tagline.length, 8)}
                placeholder="Tagline"
                aria-label="Tagline (optional)"
                {...field("tagline")}
              />
            </span>
            <textarea
              className="fund-input fund-description"
              maxLength={280}
              rows={2}
              placeholder="What you do, in a sentence"
              aria-label="Description (optional)"
              {...field("description")}
            />
            <span className="board-meta">
              <input
                className="fund-input fund-site"
                maxLength={300}
                inputMode="url"
                autoComplete="url"
                size={Math.max(value.website.length, 14)}
                placeholder="yourcompany.com"
                aria-label="Website (optional)"
                {...field("website")}
              />
              <span>{plural(clicks, "click")}</span>
              <span>{plural(pullRequests, "PR")} funded</span>
            </span>
          </>
        )}
      </span>
      <span className="board-amount">{amount}</span>
    </div>
  );
}

/** "acme.com" → "https://acme.com/"; empty → ""; anything odd → null. */
export function websiteAddress(input: string): string | null {
  const value = input.trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value)
    ? value.replace(/^http:/i, "https:")
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}
