import { describe, expect, it } from "vitest";
import {
  addressIsPublic,
  admitPublicSourceUrl,
  assertPublicResolutionAddresses,
  SourceResolutionNetworkPolicyError,
} from "@/infrastructure/research/source-resolution-network-policy";

describe("source resolution public-network policy", () => {
  it("canonicalizes an admitted public URL without tracking state", () => {
    expect(
      admitPublicSourceUrl(
        "https://Example.com/research?utm_source=test&b=2&a=1#instructions",
      ),
    ).toBe("https://example.com/research?a=1&b=2");
  });

  it.each([
    "http://localhost/source",
    "http://127.0.0.1/source",
    "http://10.20.30.40/source",
    "http://[::1]/source",
    "https://user:secret@example.com/source",
    "https://example.com:8443/source",
    "https://example.com:80/source",
    "http://example.com:443/source",
    "file:///etc/passwd",
  ])("rejects a non-public or unsafe target: %s", (url) => {
    expect(() => admitPublicSourceUrl(url)).toThrow(
      SourceResolutionNetworkPolicyError,
    );
  });

  it("requires every DNS answer to be public", () => {
    expect(addressIsPublic("93.184.216.34")).toBe(true);
    expect(addressIsPublic("198.51.99.1")).toBe(true);
    expect(addressIsPublic("198.51.100.1")).toBe(false);
    expect(addressIsPublic("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
    expect(() =>
      assertPublicResolutionAddresses(["93.184.216.34", "169.254.169.254"]),
    ).toThrow(SourceResolutionNetworkPolicyError);
  });
});
