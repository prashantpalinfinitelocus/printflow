import { redirect } from "next/navigation";

import { OrderWorkspace } from "@/components/OrderWorkspace";
import { PageHeader } from "@/components/Shell";
import { Banner } from "@/components/ui";
import { getCurrentUser } from "@/lib/session";

export default async function QueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader
        eyebrow={user.store ? `${user.store.code} · ${user.store.city ?? ""}` : "Unassigned"}
        title={user.store?.name ?? "Print queue"}
        description="Orders routed to your store. Open one to render the artwork and send it to the printer."
      />

      {!user.store && user.role === "OPERATOR" && (
        <div className="mb-5">
          <Banner kind="info">
            You are not assigned to a store yet, so no orders will appear. Ask your administrator to
            assign one.
          </Banner>
        </div>
      )}

      <OrderWorkspace />
    </>
  );
}
