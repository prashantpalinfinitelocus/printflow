import { redirect } from "next/navigation";

import { CsvIntake } from "@/components/CsvIntake";
import { PageHeader } from "@/components/Shell";
import { Banner } from "@/components/ui";
import { apiJson, getCurrentUser } from "@/lib/session";
import type { CsvBatch, PrintFormat, Store } from "@/lib/types";

/** CSV upload for operators. The API imports only their store's rows. */
export default async function OperatorUploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/admin/upload");

  const [batches, stores, formats] = await Promise.all([
    apiJson<CsvBatch[]>("/csv/batches?limit=15"),
    apiJson<Store[]>("/stores"),
    apiJson<PrintFormat[]>("/print-formats"),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={user.store ? `${user.store.code} · Intake` : "Intake"}
        title="CSV upload"
        description="Drop a CSV of orders for your store. Rows for other stores are skipped."
      />
      {user.store ? (
        <CsvIntake
          initialInbox={[]}
          initialBatches={batches ?? []}
          stores={stores ?? []}
          formats={formats ?? []}
          operatorStore={user.store}
        />
      ) : (
        <Banner kind="info">
          You are not assigned to a store yet, so you cannot import orders. Ask your administrator to
          assign one.
        </Banner>
      )}
    </>
  );
}
