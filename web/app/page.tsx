import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/session";

/** Role-based landing: admins to the console, operators to their queue. */
export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect(user.role === "ADMIN" ? "/admin" : "/queue");
}
