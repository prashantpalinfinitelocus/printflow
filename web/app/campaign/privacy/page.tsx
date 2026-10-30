import { LegalPage } from "@/components/campaign/LegalPage";

import { PRIVACY_POLICY_HTML } from "./content";

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" html={PRIVACY_POLICY_HTML} />;
}
