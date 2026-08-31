import { createHash } from "node:crypto";
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
  RetrievedSourcePayload,
  SourcePayloadRetriever,
} from "@/application/research/source-retrieval-port";
import {
  RetrievedSourcePayloadMetadataSchema,
  SourceRetrievalGrantSchema,
} from "@/application/research/source-retrieval-port";
import {
  SourceRetrievalFailureCodeSchema,
  type SourceRetrievalFailureCode,
} from "@/core/research/source-retrieval";
import { Sha256Schema } from "@/core/shared/schemas";
import {
  NodeSourceDnsResolver,
  type SourceDnsAnswer,
  type SourceDnsResolver,
} from "@/infrastructure/research/node-public-source-metadata-probe";
import {
  admitPublicSourceUrl,
  assertPublicResolutionAddresses,
} from "@/infrastructure/research/source-resolution-network-policy";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_HEADER_BYTES = 16_384;
const MAX_DNS_ANSWERS = 16;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export class SourcePayloadRetrievalError extends Error {
  readonly code: SourceRetrievalFailureCode;

  constructor(codeValue: SourceRetrievalFailureCode) {
    const code = SourceRetrievalFailureCodeSchema.parse(codeValue);
    super(`Source payload retrieval failed: ${code}`);
    this.name = "SourcePayloadRetrievalError";
    this.code = code;
  }
}

export type SourcePayloadGetResult = Readonly<{
  statusCode: number;
  location: string | null;
  declaredMediaType: string | null;
  contentEncoding: string | null;
  body: Uint8Array;
  capturedAt: string;
}>;

export interface PinnedSourceGetRequester {
  get(input: Readonly<{
    url: string;
    address: string;
    family: 4 | 6;
    allowedMediaTypes: readonly string[];
    maxWireBytes: number;
    maxHeaderBytes: number;
    timeoutMs: number;
    signal: AbortSignal;
  }>): Promise<SourcePayloadGetResult>;
}

type NodeRequest = (
  url: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

function singleHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function aborted(signal: AbortSignal) {
  return signal.reason instanceof SourcePayloadRetrievalError
    ? signal.reason
    : new SourcePayloadRetrievalError("retrieval-aborted");
}

function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(aborted(signal));
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

export class NodePinnedSourceGetRequester implements PinnedSourceGetRequester {
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

  async get(input: Parameters<PinnedSourceGetRequester["get"]>[0]) {
    if (input.signal.aborted) throw aborted(input.signal);
    const url = new URL(input.url);
    const requester = url.protocol === "https:" ? this.#httpsRequest : this.#httpRequest;
    return new Promise<SourcePayloadGetResult>((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        operation();
      };
      const options: RequestOptions = {
        method: "GET",
        agent: false,
        family: input.family,
        maxHeaderSize: input.maxHeaderBytes,
        insecureHTTPParser: false,
        signal: input.signal,
        timeout: input.timeoutMs,
        headers: {
          accept: input.allowedMediaTypes.join(", "),
          "accept-encoding": "identity",
          "user-agent": "AfterFrame-Source-Retriever/1.0",
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
          if (statusCode === undefined) {
            response.destroy();
            finish(() =>
              reject(
                new SourcePayloadRetrievalError(
                  "retrieval-upstream-unavailable",
                ),
              ),
            );
            return;
          }
          const location = singleHeader(response.headers, "location");
          const declaredMediaType = singleHeader(response.headers, "content-type");
          const contentEncoding = singleHeader(response.headers, "content-encoding");
          if (REDIRECT_STATUS_CODES.has(statusCode)) {
            response.destroy();
            finish(() =>
              resolve({
                statusCode,
                location,
                declaredMediaType,
                contentEncoding,
                body: new Uint8Array(),
                capturedAt: this.#now().toISOString(),
              }),
            );
            return;
          }
          const declaredLength = singleHeader(response.headers, "content-length");
          if (
            declaredLength !== null &&
            (!/^\d+$/.test(declaredLength) ||
              Number(declaredLength) > input.maxWireBytes)
          ) {
            response.destroy();
            finish(() =>
              reject(
                new SourcePayloadRetrievalError("retrieval-size-exceeded"),
              ),
            );
            return;
          }
          const encoding = contentEncoding?.toLowerCase() ?? null;
          if (encoding !== null && encoding !== "identity") {
            response.destroy();
            finish(() =>
              reject(
                new SourcePayloadRetrievalError(
                  "retrieval-content-encoding-rejected",
                ),
              ),
            );
            return;
          }
          const chunks: Uint8Array[] = [];
          let length = 0;
          response.on("data", (chunk: Buffer | Uint8Array | string) => {
            if (settled) return;
            const bytes =
              typeof chunk === "string"
                ? Buffer.from(chunk)
                : new Uint8Array(chunk);
            length += bytes.byteLength;
            if (length > input.maxWireBytes) {
              response.destroy();
              finish(() =>
                reject(
                  new SourcePayloadRetrievalError("retrieval-size-exceeded"),
                ),
              );
              return;
            }
            chunks.push(bytes);
          });
          response.once("aborted", () => {
            finish(() =>
              reject(
                new SourcePayloadRetrievalError(
                  "retrieval-upstream-unavailable",
                ),
              ),
            );
          });
          response.once("error", () => {
            finish(() =>
              reject(
                new SourcePayloadRetrievalError(
                  "retrieval-upstream-unavailable",
                ),
              ),
            );
          });
          response.once("end", () => {
            finish(() =>
              resolve({
                statusCode,
                location,
                declaredMediaType,
                contentEncoding,
                body: Buffer.concat(chunks, length),
                capturedAt: this.#now().toISOString(),
              }),
            );
          });
        });
      } catch {
        finish(() =>
          reject(
            new SourcePayloadRetrievalError("retrieval-upstream-unavailable"),
          ),
        );
        return;
      }
      request.once("timeout", () => {
        request.destroy(
          new SourcePayloadRetrievalError("retrieval-timeout"),
        );
      });
      request.once("error", (error: Error) => {
        finish(() =>
          reject(
            input.signal.aborted
              ? aborted(input.signal)
              : error instanceof SourcePayloadRetrievalError
                ? error
                : new SourcePayloadRetrievalError(
                    "retrieval-upstream-unavailable",
                  ),
          ),
        );
      });
      request.end();
    });
  }
}

export type NodePublicSourcePayloadRetrieverOptions = Readonly<{
  enabled: boolean;
  dns?: SourceDnsResolver;
  requester?: PinnedSourceGetRequester;
  timeoutMs?: number;
  maxHeaderBytes?: number;
}>;

export class NodePublicSourcePayloadRetriever implements SourcePayloadRetriever {
  readonly #enabled: boolean;
  readonly #dns: SourceDnsResolver;
  readonly #requester: PinnedSourceGetRequester;
  readonly #timeoutMs: number;
  readonly #maxHeaderBytes: number;

  constructor(options: NodePublicSourcePayloadRetrieverOptions) {
    this.#enabled = options.enabled;
    this.#dns = options.dns ?? new NodeSourceDnsResolver();
    this.#requester = options.requester ?? new NodePinnedSourceGetRequester();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 30_000) {
      throw new RangeError("Source retrieval timeout must be between 100 and 30000ms");
    }
    if (!Number.isInteger(this.#maxHeaderBytes) || this.#maxHeaderBytes < 1_024 || this.#maxHeaderBytes > 65_536) {
      throw new RangeError("Source retrieval header limit must be between 1024 and 65536 bytes");
    }
  }

  async retrieve(
    inputValue: Parameters<SourcePayloadRetriever["retrieve"]>[0],
    callerSignal: AbortSignal,
  ): Promise<RetrievedSourcePayload> {
    if (!this.#enabled) {
      throw new SourcePayloadRetrievalError("retrieval-disabled");
    }
    const grant = SourceRetrievalGrantSchema.parse(inputValue.grant);
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () =>
        timeoutController.abort(
          new SourcePayloadRetrievalError("retrieval-timeout"),
        ),
      this.#timeoutMs,
    );
    timeout.unref();
    const signal = AbortSignal.any([callerSignal, timeoutController.signal]);
    const requestedUrl = grant.requestedUrl;
    let currentUrl = requestedUrl;
    const redirectUrls = [requestedUrl];
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        if (signal.aborted) throw aborted(signal);
        let answers: readonly SourceDnsAnswer[];
        try {
          answers = await rejectOnAbort(
            this.#dns.resolve(new URL(currentUrl).hostname, signal),
            signal,
          );
          if (answers.length === 0 || answers.length > MAX_DNS_ANSWERS) {
            throw new SourcePayloadRetrievalError(
              "retrieval-network-rejected",
            );
          }
          for (const answer of answers) {
            if (isIP(answer.address) !== answer.family) {
              throw new SourcePayloadRetrievalError(
                "retrieval-network-rejected",
              );
            }
          }
          assertPublicResolutionAddresses(answers.map(({ address }) => address));
        } catch (error) {
          if (error instanceof SourcePayloadRetrievalError) throw error;
          throw new SourcePayloadRetrievalError("retrieval-network-rejected");
        }
        const selected = answers[0];
        if (selected === undefined) {
          throw new SourcePayloadRetrievalError("retrieval-network-rejected");
        }
        const response = await this.#requester.get({
          url: currentUrl,
          address: selected.address,
          family: selected.family,
          allowedMediaTypes: grant.allowedMediaTypes,
          maxWireBytes: grant.maxWireBytes,
          maxHeaderBytes: this.#maxHeaderBytes,
          timeoutMs: this.#timeoutMs,
          signal,
        });
        if (REDIRECT_STATUS_CODES.has(response.statusCode)) {
          if (redirectCount >= MAX_REDIRECTS || response.location === null) {
            throw new SourcePayloadRetrievalError("retrieval-redirect-invalid");
          }
          let redirected: string;
          try {
            redirected = admitPublicSourceUrl(
              new URL(response.location, currentUrl).toString(),
            );
          } catch {
            throw new SourcePayloadRetrievalError("retrieval-redirect-invalid");
          }
          if (
            new URL(currentUrl).protocol === "https:" &&
            new URL(redirected).protocol !== "https:"
          ) {
            throw new SourcePayloadRetrievalError("retrieval-redirect-invalid");
          }
          currentUrl = redirected;
          redirectUrls.push(currentUrl);
          continue;
        }
        if (response.statusCode !== 200) {
          throw new SourcePayloadRetrievalError(
            [401, 403, 407, 451].includes(response.statusCode)
              ? "retrieval-access-changed"
              : "retrieval-upstream-unavailable",
          );
        }
        const metadata = RetrievedSourcePayloadMetadataSchema.parse({
          requestedUrl,
          finalUrl: currentUrl,
          redirectChainFingerprint: Sha256Schema.parse(
            createHash("sha256")
              .update(JSON.stringify(redirectUrls), "utf8")
              .digest("hex"),
          ),
          declaredMediaType: response.declaredMediaType,
          contentEncoding: response.contentEncoding,
          wireContentLength: response.body.byteLength,
          capturedAt: response.capturedAt,
        });
        return { metadata, body: response.body };
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
