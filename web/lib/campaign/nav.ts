"use client";

/**
 * Moves within the consumer journey.
 *
 * The journey is served at /user-campaign on the domain root (next.config.ts
 * rewrites it), apart from the staff app under /offline-store. Next's router
 * prefixes every client-side navigation with the app's basePath, which would
 * carry the visitor from /user-campaign into /offline-store/user-campaign, so
 * the journey moves with full page loads instead. Its state already lives in
 * sessionStorage (store.tsx), so nothing is lost on the way.
 */

export const CAMPAIGN_ROOT = "/user-campaign";

function checked(path: string): string {
  const inCampaign = path === CAMPAIGN_ROOT || [`${CAMPAIGN_ROOT}/`, `${CAMPAIGN_ROOT}?`].some((p) => path.startsWith(p));
  if (!inCampaign) throw new Error(`Not a campaign path: ${path}`);
  return path;
}

export function useCampaignRouter() {
  return {
    push: (path: string) => window.location.assign(checked(path)),
    replace: (path: string) => window.location.replace(checked(path)),
  };
}
