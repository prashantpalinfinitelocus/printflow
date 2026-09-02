import { PageHeader } from "@/components/Shell";
import { apiJson } from "@/lib/session";
import type { PrintFormat } from "@/lib/types";

import { FormatManager } from "./FormatManager";

export default async function FormatsPage() {
  const formats = (await apiJson<PrintFormat[]>("/print-formats")) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Templates"
        title="Print formats"
        description="Each format is a PSD design plus the box the order text is stamped into. Upload a PSD, then set the text box in pixels from the top-left of the canvas."
      />
      <FormatManager initial={formats} />
    </>
  );
}
