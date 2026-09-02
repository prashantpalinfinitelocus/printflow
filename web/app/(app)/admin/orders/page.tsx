import { OrderWorkspace } from "@/components/OrderWorkspace";
import { PageHeader } from "@/components/Shell";
import { apiJson } from "@/lib/session";
import type { Store } from "@/lib/types";

export default async function AdminOrdersPage() {
  const stores = (await apiJson<Store[]>("/stores")) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="All orders"
        description="Every store's queue in one place. Admins can print or reprint on an operator's behalf."
      />
      <OrderWorkspace showStore stores={stores} />
    </>
  );
}
