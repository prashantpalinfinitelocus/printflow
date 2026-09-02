import { PageHeader } from "@/components/Shell";
import { apiJson } from "@/lib/session";
import type { Store } from "@/lib/types";

import { StoreManager } from "./StoreManager";

export default async function StoresPage() {
  const stores = (await apiJson<Store[]>("/stores")) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Master data"
        title="Stores"
        description="The store master. A CSV row routes to a store by matching its code, so codes must match exactly what the upstream system sends."
      />
      <StoreManager initial={stores} />
    </>
  );
}
