import { LegalPage } from "@/components/campaign/LegalPage";

import { TERMS_HTML } from "./content";

export default function TermsPage() {
  return <LegalPage title="Terms & Conditions" html={TERMS_HTML} />;
}
