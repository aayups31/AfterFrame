import type { LookupAddress } from "node:dns";
import { lookup as nodeLookup } from "node:dns/promises";
import {
  request as nodeHttpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as nodeHttpsRequest } from "node:https";
import { isIP } from "node:net";
import type {
  SourceCandidateResolver,
  SourceMetadataProbeTransport,
  SourceResolutionProbe,
} from "@/application/research/source-resolution-port";
import { SourceResolutionProbeSchema } from "@/application/research/source-resolution-port";
import {
  admitPublicSourceUrl,
  assertPublicResolutionAddresses,
} from "@/infrastructure/research/source-resolution-network-policy";
import { DeterministicSourceMetadataResolver } from "@/infrastructure/research/deterministic-source-metadata-resolver";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_HEADER_BYTES = 16_384;
const MAX_DNS_ANSWERS = 16;
const MAX_CONTENT_LENGTH = 100_000_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export type SourceMetadataProbeFailureCode =
  | "disabled"
  | "aborted"
  | "timeout"
  | "dns-unavailable"
  | "dns-answer-invalid"
  | "network-target-rejected"
  | "request-failed"
  | "redirect-location-invalid"
  | "redirect-limit-exceeded";

export class SourceMetadataProbeError extends Error {
  readonly code: SourceMetadataProbeFailureCode;

  constructor(code: SourceMetadataProbeFailureCode) {
    super(`Source metadata probe failed: ${code}`);
    this.name = "SourceMetadataProbeError";
    this.code = code;
  }
}

export type SourceDnsAnswer = Readonly<{ address: string; family: 4 | 6 }>;

export type SourceMetadataHeadResult = Readonly<{
  statusCode: number;
  location: string | null;
  contentType: string | null;
  contentLength: number | null;
  observedAt: string;
}>;

export interface SourceDnsResolver {
  resolve(hostname: string, signal: AbortSignal): Promise<readonly SourceDnsAnswer[]>;
}

export interface PinnedSourceHeadRequester {
  head(input: Readonly<{
    url: string;
    address: string;
    family: 4 | 6;
    signal: AbortSignal;
    timeoutMs: number;
    maxHeaderBytes: number;
  }>): Promise<SourceMetadataHeadResult>;
}

type NodeRequest = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

function abortFailure(signal: AbortSignal) {
  return signal.reason instanceof SourceMetadataProbeError
    ? signal.reason
    : new SourceMetadataProbeError("aborted");
}

function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortFailure(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortFailure(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class NodeSourceDnsResolver implements SourceDnsResolver {
  async resolve(hostname: string, signal: AbortSignal) {
    let answers: LookupAddress[];
    try {
      answers = await rejectOnAbort(
        nodeLookup(hostname, { all: true, verbatim: true }) as Promise<
          LookupAddress[]
        >,
        signal,
      );
    } catch {
      if (signal.aborted) throw abortFailure(signal);
      throw new SourceMetadataProbeError("dns-unavailable");
    }
    return answers.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    })) satisfies readonly SourceDnsAnswer[];
  }
}

function singleHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function safeContentLength(headers: IncomingHttpHeaders) {
  const value = singleHeader(headers, "content-length");
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_CONTENT_LENGTH
    ? parsed
    : null;
}

export class NodePinnedSourceHeadRequester implements PinnedSourceHeadRequester {
  readonly #httpRequest: NodeRequest;
  readonly #httpsRequest: NodeRequest;
  readonly #now: () => Date;

  constructor(options: Readonly<{
    httpRequest?: NodeRequest;
    httpsRequest?: NodeRequest;
    now?: () => Date;
  }> = {}) {
    this.#httpRequest = options.httpRequest ?? nodeHttpRequest;
    this.#httpsRequest = options.httpsRequest ?? nodeHttpsRequest;
    this.#now = options.now ?? (() => new Date());
  }

  async head(input: Parameters<PinnedSourceHeadRequester["head"]>[0]) {
    if (input.signal.aborted) throw abortFailure(input.signal);
    const url = new URL(input.url);
    const requester = url.protocol === "https:" ? this.#httpsRequest : this.#httpRequest;
    return new Promise<SourceMetadataHeadResult>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        operation();
      };
      const options: RequestOptions = {
        method: "HEAD",
        agent: false,
        family: input.family,
        maxHeaderSize: input.maxHeaderBytes,
        insecureHTTPParser: false,
        signal: input.signal,
        timeout: input.timeoutMs,
        headers: {
          accept: "*/*",
          "accept-encoding": "identity",
          "user-agent": "AfterFrame-Source-Metadata-Probe/1.0",
        },
        lookup: (_hostname, _options, callback) => {
          callback(null, input.address, input.family);
        },
        ...(url.protocol === "https:"
          ? {
              servername: url.hostname,
              rejectUnauthorized: true,
              minVersion: "TLSv1.2" as const,
            }
          : {}),
      };
      let request: ClientRequest;
      try {
        request = requester(url, options, (response) => {
          const statusCode = response.statusCode;
          const observedAt = this.#now().toISOString();
          const result =
            statusCode === undefined
              ? null
              : {
                  statusCode,
                  location: singleHeader(response.headers, "location"),
                  contentType: singleHeader(response.headers, "content-type"),
                  contentLength: safeContentLength(response.headers),
                  observedAt,
                };
          response.destroy();
          if (result === null) {
            finish(() => reject(new SourceMetadataProbeError("request-failed")));
          } else {
            finish(() => resolve(result));
          }
        });
      } catch {
        finish(() => reject(new SourceMetadataProbeError("request-failed")));
        return;
      }
      request.once("timeout", () => {
        request.destroy(new SourceMetadataProbeError("timeout"));
      });
      request.once("error", (error: Error) => {
        finish(() =>
          reject(
            input.signal.aborted
              ? abortFailure(input.signal)
              : error instanceof SourceMetadataProbeError
                ? error
                : new SourceMetadataProbeError("request-failed"),
          ),
        );
      });
      request.end();
    });
  }
}

export type NodePublicSourceMetadataProbeOptions = Readonly<{
  enabled: boolean;
  dns?: SourceDnsResolver;
  requester?: PinnedSourceHeadRequester;
  timeoutMs?: number;
  maxHeaderBytes?: number;
}>;

export class NodePublicSourceMetadataProbe implements SourceMetadataProbeTransport {
  readonly #enabled: boolean;
  readonly #dns: SourceDnsResolver;
  readonly #requester: PinnedSourceHeadRequester;
  readonly #timeoutMs: number;
  readonly #maxHeaderBytes: number;

  constructor(options: NodePublicSourceMetadataProbeOptions) {
    this.#enabled = options.enabled;
    this.#dns = options.dns ?? new NodeSourceDnsResolver();
    this.#requester = options.requester ?? new NodePinnedSourceHeadRequester();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 30_000) {
      throw new RangeError("Source metadata probe timeout must be between 100 and 30000ms");
    }
    if (!Number.isInteger(this.#maxHeaderBytes) || this.#maxHeaderBytes < 1_024 || this.#maxHeaderBytes > 65_536) {
      throw new RangeError("Source metadata probe header limit must be between 1024 and 65536 bytes");
    }
  }

  async probe(
    value: string,
    options: Readonly<{ maxRedirects: number; signal: AbortSignal }>,
  ): Promise<SourceResolutionProbe> {
    if (!this.#enabled) throw new SourceMetadataProbeError("disabled");
    if (!Number.isInteger(options.maxRedirects) || options.maxRedirects < 0 || options.maxRedirects > 5) {
      throw new RangeError("Source metadata probe redirect limit must be between 0 and 5");
    }
    let requestedUrl: string;
    try {
      requestedUrl = admitPublicSourceUrl(value);
    } catch {
      throw new SourceMetadataProbeError("network-target-rejected");
    }
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new SourceMetadataProbeError("timeout")),
      this.#timeoutMs,
    );
    timeout.unref();
    const signal = AbortSignal.any([options.signal, timeoutController.signal]);
    const hops: SourceResolutionProbe["hops"] = [];
    let currentUrl = requestedUrl;
    try {
      while (true) {
        if (signal.aborted) throw abortFailure(signal);
        let answers: readonly SourceDnsAnswer[];
        try {
          answers = await rejectOnAbort(
            this.#dns.resolve(new URL(currentUrl).hostname, signal),
            signal,
          );
          if (answers.length === 0 || answers.length > MAX_DNS_ANSWERS) {
            throw new SourceMetadataProbeError("dns-answer-invalid");
          }
          for (const answer of answers) {
            if (isIP(answer.address) !== answer.family) {
              throw new SourceMetadataProbeError("dns-answer-invalid");
            }
          }
          assertPublicResolutionAddresses(answers.map(({ address }) => address));
        } catch (error) {
          if (error instanceof SourceMetadataProbeError) throw error;
          throw new SourceMetadataProbeError("network-target-rejected");
        }
        const selected = answers[0];
        if (selected === undefined) throw new SourceMetadataProbeError("dns-answer-invalid");
        const response = await this.#requester.head({
          url: currentUrl,
          address: selected.address,
          family: selected.family,
          signal,
          timeoutMs: this.#timeoutMs,
          maxHeaderBytes: this.#maxHeaderBytes,
        });
        hops.push({
          url: currentUrl,
          statusCode: response.statusCode,
          resolvedAddresses: answers.map(({ address }) => address),
          contentType: response.contentType,
          contentLength: response.contentLength,
          title: null,
          observedAt: response.observedAt,
        });
        if (!REDIRECT_STATUS_CODES.has(response.statusCode)) break;
        if (hops.length > options.maxRedirects) {
          throw new SourceMetadataProbeError("redirect-limit-exceeded");
        }
        if (response.location === null) {
          throw new SourceMetadataProbeError("redirect-location-invalid");
        }
        try {
          currentUrl = admitPublicSourceUrl(new URL(response.location, currentUrl).toString());
        } catch {
          throw new SourceMetadataProbeError("redirect-location-invalid");
        }
      }
      return SourceResolutionProbeSchema.parse({
        requestedUrl,
        hops,
        bodyIncluded: false,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** Production composition remains explicit so network access cannot appear by import. */
export function createNodePublicSourceMetadataResolver(
  options: NodePublicSourceMetadataProbeOptions,
): SourceCandidateResolver {
  return new DeterministicSourceMetadataResolver(
    new NodePublicSourceMetadataProbe(options),
  );
}
