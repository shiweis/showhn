/**
 * Network helpers for fetching user-supplied project URLs safely.
 *
 * Application-level checks are defense in depth. Production should also deny
 * private/link-local address ranges at the worker's network boundary so DNS
 * rebinding cannot win a check/use race.
 */

import dns from "node:dns/promises";
import net from "node:net";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
];

export type ResolvedAddress = { address: string; family: number };
export type HostLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultLookup: HostLookup = async (hostname) =>
  dns.lookup(hostname, { all: true, verbatim: true });

async function lookupWithTimeout(
  lookup: HostLookup,
  hostname: string,
  timeoutMs = 5_000,
): Promise<ResolvedAddress[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`DNS lookup timed out: ${hostname}`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (
    ((octets[0] << 24) >>> 0) +
    (octets[1] << 16) +
    (octets[2] << 8) +
    octets[3]
  ) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPublicIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (value === null) return false;

  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ];

  return !blocked.some(([base, prefix]) => {
    const baseValue = ipv4ToNumber(base)!;
    return inIpv4Range(value, baseValue, prefix);
  });
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase().split("%")[0];
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);

  const ipv4Match = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = ipv4ToNumber(ipv4Match[1]);
    if (ipv4 === null) return null;
    value = value.slice(0, -ipv4Match[1].length) +
      `${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }

  if ((value.match(/::/g) || []).length > 1) return null;
  const [leftRaw, rightRaw] = value.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (!value.includes("::") && missing !== 0)) return null;

  const parts = [
    ...left,
    ...Array.from({ length: missing }, () => "0"),
    ...right,
  ];
  if (parts.length !== 8) return null;

  const numbers = parts.map((part) => Number.parseInt(part || "0", 16));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
    return null;
  }
  return numbers;
}

export function isPublicIpv6(address: string): boolean {
  const parts = expandIpv6(address);
  if (!parts) return false;

  const allZeroThroughFive = parts.slice(0, 6).every((part) => part === 0);
  const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (allZeroThroughFive || ipv4Mapped) {
    const embedded = `${parts[6] >>> 8}.${parts[6] & 0xff}.${parts[7] >>> 8}.${parts[7] & 0xff}`;
    return isPublicIpv4(embedded);
  }

  // NAT64 well-known prefix 64:ff9b::/96.
  if (parts[0] === 0x64 && parts[1] === 0xff9b && parts.slice(2, 6).every((part) => part === 0)) {
    const embedded = `${parts[6] >>> 8}.${parts[6] & 0xff}.${parts[7] >>> 8}.${parts[7] & 0xff}`;
    return isPublicIpv4(embedded);
  }

  // Only globally routable unicast (2000::/3). This excludes loopback,
  // unspecified, multicast, link-local, unique-local, and documentation ranges.
  if ((parts[0] & 0xe000) !== 0x2000) return false;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  return true;
}

export function isPublicIp(address: string): boolean {
  const family = net.isIP(address.replace(/^\[|\]$/g, ""));
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export async function assertPublicUrl(
  input: string | URL,
  lookup: HostLookup = defaultLookup,
): Promise<URL> {
  const url = input instanceof URL ? new URL(input) : new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked URL protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("Blocked URL containing embedded credentials");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error(`Blocked private hostname: ${hostname}`);
  }

  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error(`Blocked non-public address: ${hostname}`);
    return url;
  }

  const addresses = await lookupWithTimeout(lookup, hostname);
  if (addresses.length === 0) throw new Error(`Hostname did not resolve: ${hostname}`);
  const blocked = addresses.find(({ address }) => !isPublicIp(address));
  if (blocked) throw new Error(`Hostname resolved to a non-public address: ${hostname}`);
  return url;
}

export type BoundedFetchOptions = {
  headers?: HeadersInit;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookup?: HostLookup;
};

export type BoundedFetchResult = {
  ok: boolean;
  status: number;
  headers: Headers;
  body: Uint8Array;
  finalUrl: URL;
};

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    controller.abort();
    throw new Error(`Response exceeded ${maxBytes} bytes`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      controller.abort();
      throw new Error(`Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Fetch a public HTTP(S) resource with redirect, time, and byte limits. */
export async function fetchPublicResource(
  input: string | URL,
  options: BoundedFetchOptions = {},
): Promise<BoundedFetchResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = input instanceof URL ? new URL(input) : new URL(input);

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    current = await assertPublicUrl(current, options.lookup ?? defaultLookup);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, {
        method: "GET",
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Redirect response omitted Location header");
        if (redirects === maxRedirects) throw new Error("Too many redirects");
        current = new URL(location, current);
        continue;
      }

      const body = await readBoundedBody(response, maxBytes, controller);
      return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        body,
        finalUrl: current,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Too many redirects");
}
