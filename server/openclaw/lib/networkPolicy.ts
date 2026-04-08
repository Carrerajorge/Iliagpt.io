const BLOCKED_HOSTS = new Set([
  "169.254.169.254", // AWS EC2 metadata
  "metadata.google.internal", // GCP metadata
  "100.100.100.200", // Alibaba Cloud metadata
  "fd00:ec2::254", // AWS EC2 metadata (IPv6)
]);

/** CIDR ranges that must not be reachable from tool egress. */
const BLOCKED_CIDRS: Array<{ base: number; mask: number; label: string }> = [
  { base: ipToInt("127.0.0.0"), mask: cidrMask(8), label: "127.0.0.0/8" },
  { base: ipToInt("10.0.0.0"), mask: cidrMask(8), label: "10.0.0.0/8" },
  { base: ipToInt("172.16.0.0"), mask: cidrMask(12), label: "172.16.0.0/12" },
  { base: ipToInt("192.168.0.0"), mask: cidrMask(16), label: "192.168.0.0/16" },
  { base: ipToInt("0.0.0.0"), mask: cidrMask(8), label: "0.0.0.0/8" },
];

function ipToInt(ip: string): number {
  const parts = ip.split(".").map(Number);
  // eslint-disable-next-line no-bitwise
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrMask(bits: number): number {
  // eslint-disable-next-line no-bitwise
  return bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  const addr = ipToInt(ip);
  for (const cidr of BLOCKED_CIDRS) {
    // eslint-disable-next-line no-bitwise
    if ((addr & cidr.mask) === (cidr.base & cidr.mask)) {
      return true;
    }
  }
  return false;
}

export function isAllowedUrl(url: string): { allowed: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block cloud metadata endpoints by hostname
  if (BLOCKED_HOSTS.has(hostname)) {
    return { allowed: false, reason: `Blocked host: ${hostname}` };
  }

  // Block IP-based access to private ranges
  const ipv4Match = hostname.match(/^(\d{1,3}\.){3}\d{1,3}$/);
  if (ipv4Match && isPrivateIp(hostname)) {
    return { allowed: false, reason: `Private IP blocked: ${hostname}` };
  }

  // Block non-http(s) schemes
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { allowed: false, reason: `Blocked protocol: ${parsed.protocol}` };
  }

  return { allowed: true };
}
