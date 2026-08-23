import { isIP } from "node:net";

export class SourceResolutionNetworkPolicyError extends Error {
  constructor() {
    super("Source resolution target is not admitted by the public-network policy");
    this.name = "SourceResolutionNetworkPolicyError";
  }
}

function ipv4IsPublic(value: string) {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a = 0, b = 0, c = 0] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && [18, 19].includes(b)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6IsPublic(value: string) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) {
    return ipv4IsPublic(normalized.slice("::ffff:".length));
  }
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export function addressIsPublic(value: string) {
  const version = isIP(value.replace(/^\[|\]$/g, ""));
  if (version === 4) return ipv4IsPublic(value);
  if (version === 6) return ipv6IsPublic(value);
  return false;
}

export function assertPublicResolutionAddresses(addresses: readonly string[]) {
  if (addresses.length === 0 || addresses.some((value) => !addressIsPublic(value))) {
    throw new SourceResolutionNetworkPolicyError();
  }
}

export function admitPublicSourceUrl(value: string) {
  if (value.length > 8_192) throw new SourceResolutionNetworkPolicyError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SourceResolutionNetworkPolicyError();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw new SourceResolutionNetworkPolicyError();
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    (isIP(hostname) !== 0 && !addressIsPublic(hostname))
  ) {
    throw new SourceResolutionNetworkPolicyError();
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (
      key.toLowerCase().startsWith("utm_") ||
      ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  return url.toString();
}
