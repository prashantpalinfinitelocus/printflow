import { PageHeader } from "@/components/Shell";
import { apiJson } from "@/lib/session";
import type { CsvBatch, InboxFile, PrintFormat, Store } from "@/lib/types";

import { CsvIntake } from "./CsvIntake";

export default async function UploadPage() {
  const [inbox, batches, stores, formats] = await Promise.all([
    apiJson<InboxFile[]>("/csv/inbox"),
    apiJson<CsvBatch[]>("/csv/batches?limit=15"),
    apiJson<Store[]>("/stores"),
    apiJson<PrintFormat[]>("/print-formats"),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Intake"
        title="CSV upload"
        description="Drop a CSV here, or import one that was placed in the watched inbox folder on the server. Each row is routed to a store's queue by its store code."
      />
      <CsvIntake
        initialInbox={inbox ?? []}
        initialBatches={batches ?? []}
        stores={stores ?? []}
        formats={formats ?? []}
      />
    </>
  );
}
