/**
 * The app is served under this prefix (Next.js `basePath`). Link, router and
 * redirect() add it on their own; a raw fetch() or <a>/<img> URL does not, so
 * those go through withBasePath().
 */
export const BASE_PATH = "/offline-store";

export const withBasePath = (path: string) => `${BASE_PATH}${path}`;
