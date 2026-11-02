"use client";

import { useEffect, useState } from "react";

import { campaignApi } from "@/lib/campaign/api";
import { addedDesign, designById, DESIGNS, type CanDesign } from "@/lib/campaign/designs";

/**
 * The designs users can pick: the built-in ones an admin has not hidden, then the ones an admin
 * added (lib/campaign/api listDesigns). Loaded once per page and shared by every component that
 * shows designs. A failed load leaves the built-in designs and is tried again next time.
 */
let shown: CanDesign[] = DESIGNS;
let pending: Promise<CanDesign[]> | null = null;

export function loadDesigns(): Promise<CanDesign[]> {
  pending ??= campaignApi.listDesigns().then(
    ({ added, hidden }) => (shown = [...DESIGNS.filter((d) => !hidden.includes(d.id)), ...added.map(addedDesign)]),
    () => {
      pending = null;
      return DESIGNS;
    },
  );
  return pending;
}

/** For tests: forget the loaded designs. */
export function resetDesigns() {
  shown = DESIGNS;
  pending = null;
}

/** The designs users can pick, and a lookup that falls back to a design still shown. */
export function useDesigns() {
  const [designs, setDesigns] = useState<CanDesign[]>(shown);
  useEffect(() => {
    let current = true;
    void loadDesigns().then((list) => current && setDesigns(list));
    return () => {
      current = false;
    };
  }, []);
  return { designs, find: (id: string) => designById(id, designs) };
}
