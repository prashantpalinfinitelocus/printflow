import { Landing } from "@/components/campaign/Landing";

/**
 * Reads the query on the server and hands it down, so the splash is in the HTML.
 * useSearchParams in a client page would need a Suspense boundary, and Next would
 * then render the whole splash on the client only.
 */
export default async function LandingPage({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const { login } = await searchParams;
  return <Landing openLogin={login === "1"} />;
}
