import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/session";

/** Server-side admin gate. The API enforces this too — this only avoids a dead-end UI. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/queue");
  return <>{children}</>;
}
