/** The company that publishes Yarrow: its founder's own company, as registered in France. */
export const company = {
  name: "TOTEM",
  form: "EURL (single-member limited liability company) with a share capital of €1,000",
  registry: "RCS Nanterre 881 263 503",
  vat: "FR37881263503",
  address: "1 avenue Galois, 92340 Bourg-la-Reine, France",
  director: "Kevin Taleb Dehkordi",
  email: "contact@yarrow.run",
} as const;

/** The same sentence on the legal pages, emails and JSON-LD. */
export const operatorStatement =
  "Yarrow (yarrow.run) is a product of TOTEM, an EURL registered in France.";

/** Organization plus website, so a crawler reads who publishes the site. */
export function siteJsonLd(url: string) {
  const publisher = {
    "@type": "Organization",
    name: "Yarrow",
    legalName: company.name,
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
        name: "Yarrow",
        url,
        description: operatorStatement,
        publisher,
      },
    ],
  };
}
