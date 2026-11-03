import { render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CampaignError, CampaignServerError } from "@/lib/campaign/api";
import { gaEventNames, gaEvents } from "@/test/campaign";

import { CampaignAnalytics, TrackOnce, failureReason, track, useTrackOnce } from "./analytics";

const gaScripts = () => document.head.querySelectorAll('script[src*="googletagmanager"]');

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.pushState({}, "", "/");
});

describe("track", () => {
  it("loads the GA4 tag for the measurement ID the first time, and only once", () => {
    track("campaign_cta_clicked");
    track("login_screen_viewed");
    expect(gaScripts()).toHaveLength(1);
    expect(gaScripts()[0].getAttribute("src")).toBe("https://www.googletagmanager.com/gtag/js?id=G-TEST");
    expect(gaScripts()[0]).toHaveProperty("async", true);
  });

  it("queues js and config ahead of the first event, or gtag would have nowhere to send it", () => {
    track("campaign_cta_clicked");
    const commands = window.dataLayer!.map((call) => (call as ArrayLike<unknown>)[0]);
    expect(commands).toEqual(["js", "config", "event"]);
    expect(Array.from(window.dataLayer![1] as ArrayLike<unknown>)).toEqual(["config", "G-TEST"]);
  });

  it("queues real arguments objects, because gtag.js silently ignores plain arrays", () => {
    track("campaign_cta_clicked");
    for (const call of window.dataLayer!) expect(Object.prototype.toString.call(call)).toBe("[object Arguments]");
  });

  it("sends the event's parameters", () => {
    track("moderation_completed", { moderation_status: "approved" });
    expect(gaEvents()).toEqual([{ name: "moderation_completed", moderation_status: "approved" }]);
  });

  it("does nothing without a measurement ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_MEASUREMENT_ID", "");
    track("campaign_cta_clicked");
    expect(window.dataLayer).toBeUndefined();
    expect(gaScripts()).toHaveLength(0);
  });

  it.each(["/user-campaign/admin", "/user-campaign/admin/login", "/offline-store/user-campaign/admin"])(
    "stays off on the staff page %s",
    (path) => {
      window.history.pushState({}, "", path);
      track("campaign_cta_clicked");
      expect(window.dataLayer).toBeUndefined();
    },
  );
});

describe("CampaignAnalytics", () => {
  it("starts GA on a page that sends no event of its own, so the session and page view count", () => {
    render(<CampaignAnalytics />);
    expect(gaScripts()).toHaveLength(1);
    expect(gaEventNames()).toEqual([]);
  });
});

describe("useTrackOnce", () => {
  function View({ when }: { when?: boolean }) {
    useTrackOnce("preview_viewed", when);
    return null;
  }

  it("fires once through Strict Mode's double effects and re-renders", () => {
    const { rerender } = render(
      <StrictMode>
        <View />
      </StrictMode>,
    );
    rerender(
      <StrictMode>
        <View />
      </StrictMode>,
    );
    expect(gaEventNames()).toEqual(["preview_viewed"]);
  });

  it("waits until the screen is really showing", () => {
    const { rerender } = render(<View when={false} />);
    expect(gaEventNames()).toEqual([]);
    rerender(<View when />);
    expect(gaEventNames()).toEqual(["preview_viewed"]);
  });

  it("is usable from a server component through TrackOnce", () => {
    render(<TrackOnce event="thank_you_viewed" />);
    expect(gaEventNames()).toEqual(["thank_you_viewed"]);
  });
});

describe("failureReason", () => {
  it("reports the server's fixed code, never its message", () => {
    expect(failureReason(new CampaignError("OTP_WRONG", "That code doesn't match."))).toBe("otp_wrong");
  });

  it.each([new CampaignServerError("free text from the server"), new TypeError("fetch failed")])(
    "groups anything without a code as unknown",
    (err) => expect(failureReason(err)).toBe("unknown"),
  );
});
