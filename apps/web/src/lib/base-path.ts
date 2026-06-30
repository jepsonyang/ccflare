/**
 * The dashboard mount prefix injected by the server into `index.html`
 * (`window.__ccflareBasePath`). Empty string when the dashboard is served at
 * the root. Already normalized server-side (leading slash, no trailing slash).
 */
export function getBasePath(): string {
	return (typeof window !== "undefined" && window.__ccflareBasePath) || "";
}
