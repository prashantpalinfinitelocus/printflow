import { redirect } from "next/navigation";

import { Shell } from "@/components/Shell";
import { getCurrentUser } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  // The cookie can outlive the session (deactivated user, restarted API).
  if (!user) redirect("/login");
  return <Shell user={user}>{children}</Shell>;
}
