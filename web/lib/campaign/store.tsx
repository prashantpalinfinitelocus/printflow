"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import type { Session } from "@/lib/campaign/api";
import { DEFAULT_DESIGN_ID } from "@/lib/campaign/designs";

interface CampaignState {
  session: Session | null;
  designId: string;
  text: string;
  /** The text moderation last approved; preview and entry need it to equal `text`. */
  approvedText: string | null;
  headsUpSeen: boolean;
}

const INITIAL: CampaignState = {
  session: null,
  designId: DEFAULT_DESIGN_ID,
  text: "",
  approvedText: null,
  headsUpSeen: false,
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
      if (saved) setState({ ...INITIAL, ...JSON.parse(saved) });
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
