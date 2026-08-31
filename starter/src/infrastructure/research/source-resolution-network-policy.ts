import { BlockList, isIP } from "node:net";

export class SourceResolutionNetworkPolicyError extends Error {
  constructor() {
    super("Source resolution target is not admitted by the public-network policy");
    this.name = "SourceResolutionNetworkPolicyError";
  }
}

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export function addressIsPublic(value: string) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) return !blockedIpv4Addresses.check(normalized, "ipv4");
  if (version === 6) return !blockedIpv6Addresses.check(normalized, "ipv6");
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
