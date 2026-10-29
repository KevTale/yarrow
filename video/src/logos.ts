/**
 * The invented sponsors' logos, drawn on a 48 grid edge to edge: whoever
 * shows them rounds the corners. Data URIs, so the PR card's SVG can inline
 * them as the real card inlines a sponsor's logo.
 */
const svg = (body: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`,
  )}`;

/** Quillfern Labs: a quill, its vein and two barbs. */
export const quillfern = svg(
  `<rect width="48" height="48" fill="#12233b"/>` +
    `<path d="M37 9C24 10 15 19 14 33l-2.5 5.5 2 1 2.5-5.5c13-1 21.5-10 21-25z" fill="#9fd4ff"/>` +
    `<path d="M15.5 32.5L31 16M20 22.5l5.5 2.5M25 17l4.5 2" stroke="#12233b" stroke-width="2" stroke-linecap="round" fill="none"/>`,
);

/** Mossgrove: three pines on a line of ground. */
export const mossgrove = svg(
  `<rect width="48" height="48" fill="#b9e3a8"/>` +
    `<g fill="#1d3b24" stroke="#1d3b24" stroke-width="2" stroke-linejoin="round">` +
    `<path d="M9.5 35L14 25.5L18.5 35Z"/><path d="M15.5 35L21 19L26.5 35Z"/><path d="M23.5 35L30.5 12.5L37.5 35Z"/>` +
    `</g><rect x="8" y="36" width="32" height="3" rx="1.5" fill="#1d3b24"/>`,
);

/** Orbitkit: a planet, its tilted orbit and a satellite on it. */
export const orbitkit = svg(
  `<rect width="48" height="48" fill="#f5b8a8"/>` +
    `<ellipse cx="24" cy="24" rx="17" ry="7" transform="rotate(-30 24 24)" fill="none" stroke="#3b1710" stroke-width="2.5"/>` +
    `<circle cx="24" cy="24" r="7.5" fill="#3b1710"/>` +
    `<circle cx="38.7" cy="15.5" r="3.5" fill="#3b1710" stroke="#f5b8a8" stroke-width="2"/>`,
);
