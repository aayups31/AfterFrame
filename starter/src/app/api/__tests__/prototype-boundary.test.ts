import { afterEach, describe, expect, it } from "vitest";
import { POST as closeInvestigation } from "@/app/api/cases/[caseId]/close/route";
import { POST as submitHttpDirection } from "@/app/api/cases/[caseId]/directions/route";
import { POST as investigate } from "@/app/api/investigate/route";

const previousMockMode = process.env.AFTERFRAME_MOCK_MODE;

afterEach(() => {
  if (previousMockMode === undefined) {
    delete process.env.AFTERFRAME_MOCK_MODE;
  } else {
    process.env.AFTERFRAME_MOCK_MODE = previousMockMode;
  }
});

function investigationRequest() {
  return new Request("http://afterframe.test/api/investigate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      film: { title: "An arbitrary identifiable movie", year: 2025 },
      curiosity: "Why does the ending change the meaning of the opening?",
    }),
  });
}

describe("prototype HTTP safety boundary", () => {
  it("refuses live investigation instead of making an unverified model call", async () => {
    process.env.AFTERFRAME_MOCK_MODE = "false";

    const response = await investigate(investigationRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ error: "LIVE_RESEARCH_NOT_COMPOSED" });
    expect(body).not.toHaveProperty("outputText");
  });

  it("labels prototype output as non-authoritative and non-cacheable", async () => {
    process.env.AFTERFRAME_MOCK_MODE = "true";

    const response = await investigate(investigationRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-AfterFrame-Mode")).toBe("prototype-mock");
    expect(body.mode).toBe("prototype-mock");
    expect(body.warning).toContain("non-authoritative");
  });

  it("does not expose fake production direction or closure adapters", async () => {
    const [directionResponse, closureResponse] = await Promise.all([
      submitHttpDirection(),
      closeInvestigation(),
    ]);

    expect(directionResponse.status).toBe(501);
    expect(closureResponse.status).toBe(501);
    await expect(directionResponse.json()).resolves.toMatchObject({
      error: "DIRECTION_ADAPTER_NOT_COMPOSED",
    });
    await expect(closureResponse.json()).resolves.toMatchObject({
      error: "CLOSURE_NOT_IMPLEMENTED",
    });
  });
});
