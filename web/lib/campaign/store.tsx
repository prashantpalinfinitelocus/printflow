"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import type { Session } from "@/lib/campaign/api";
import { DEFAULT_DESIGN_ID, designById } from "@/lib/campaign/designs";
import { loadDesigns } from "@/lib/campaign/useDesigns";

interface CampaignState {
  session: Session | null;
  designId: string;
  text: string;
  /** The text moderation last approved; preview and entry need it to equal `text`. */
  approvedText: string | null;
  headsUpSeen: boolean;
  /** The server refused the text at submit; the customiser shows the friendly-content popup. */
  textRejected: boolean;
  /**
   * An entry sent but not confirmed. Its idempotency key outlives a reload, so a
   * submit whose response was lost cannot become a second entry on retry.
   */
  pendingEntry: { key: string; designId: string; text: string } | null;
}

const INITIAL: CampaignState = {
  session: null,
  designId: DEFAULT_DESIGN_ID,
  text: "",
  approvedText: null,
  headsUpSeen: false,
  textRejected: false,
  pendingEntry: null,
};

const STORAGE_KEY = "dc-campaign";

interface CampaignContextValue extends CampaignState {
  /** False until sessionStorage has been read, so guards don't redirect too early. */
  ready: boolean;
  update: (patch: Partial<CampaignState>) => void;
}

const CampaignContext = createContext<CampaignContextValue | null>(null);

/**
 * Journey state for one tab. sessionStorage keeps the design and text across a
 * reload or a back-navigation (PRD 7) without outliving the browser session.
 */
export function CampaignProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CampaignState>(INITIAL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const restored: CampaignState = { ...INITIAL, ...JSON.parse(saved) };
        setState(restored);
        // A design retired or hidden since the tab was opened falls back to one we can still print.
        // Added designs count as current, so this waits for the designs before deciding.
        void loadDesigns().then((shown) => {
          const known = designById(restored.designId, shown).id;
          if (known !== restored.designId) setState((s) => (s.designId === restored.designId ? { ...s, designId: known } : s));
        });
      }
    } catch {
      /* storage blocked or corrupt — start fresh */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage blocked — the journey still works, it just won't survive a reload */
    }
  }, [state, ready]);

  const update = useCallback((patch: Partial<CampaignState>) => setState((s) => ({ ...s, ...patch })), []);

  return <CampaignContext.Provider value={{ ...state, ready, update }}>{children}</CampaignContext.Provider>;
}

export function useCampaign() {
  const ctx = useContext(CampaignContext);
  if (!ctx) throw new Error("useCampaign must be used inside CampaignProvider");
  return ctx;
}
