/** Public identity of the company that operates the site. */
export const company = {
  name: "Yarrow",
  founded: "September 2026",
  /** ISO year-month, for structured data. */
  foundingDate: "2026-09",
  email: "contact@yarrow.run",
} as const;

/** The same sentence on the legal pages, emails and JSON-LD. */
export const operatorStatement =
  "Yarrow (yarrow.run) is operated by the company Yarrow, founded in September 2026.";

/** Organization plus website, so a crawler reads who operates the site. */
export function siteJsonLd(url: string) {
  const publisher = {
    "@type": "Organization",
    name: company.name,
    legalName: company.name,
    foundingDate: company.foundingDate,
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        ...publisher,
        url,
        email: company.email,
        description: operatorStatement,
      },
      {
        "@type": "WebSite",
        name: company.name,
        url,
        description: operatorStatement,
        publisher,
      },
    ],
  };
}
