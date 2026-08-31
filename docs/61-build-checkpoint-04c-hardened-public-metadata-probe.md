# Build checkpoint 04C.4 — hardened public metadata probe

Date: 2026-08-30

## Outcome

AFTERFRAME now has a production-composable, body-free public-network transport
for the RESOLUTION stage. A discovered URL still is not evidence. The adapter
can establish only that a conservatively admitted public source endpoint
exists and can return bounded response metadata for a source-level proposal.

The adapter is disabled by default and requires an explicit server-side kill
switch. Importing it, creating the normal executor registry, or having API
credentials present cannot cause network access.

## Network security boundary

Every request hop now passes all of these controls before a socket is opened:

1. canonical HTTP/HTTPS URL admission with credentials, explicit ports, local
   hostnames, fragments, and tracking parameters rejected or removed;
2. DNS resolution with a maximum of 16 answers;
3. address-family validation and rejection if **any** answer is local,
   private, link-local, multicast, documentation, benchmarking, transition,
   or otherwise special-use space;
4. selection of one already validated address and a custom socket lookup that
   pins the connection to that exact IP;
5. original hostname preservation for the HTTP Host header, TLS SNI, and
   certificate validation;
6. TLS 1.2 minimum for HTTPS, the platform trust store, and no custom
   certificate bypass;
7. `HEAD` only, no ambient cookies, authorization, referrer, compression, or
   connection pooling;
8. bounded response headers, one overall abortable deadline, and immediate
   response destruction after whitelisted headers are read.

Only status, canonical hop URL, validated DNS answers, content type, safe
content length, and observation time can cross the transport contract. Source
bodies, response headers, socket errors, and upstream error text cannot cross.

## Redirect and rebinding resistance

Only 301, 302, 303, 307, and 308 are navigation redirects. Each relative or
absolute `Location` is admitted as a new URL, then independently DNS-resolved,
fully revalidated, and socket-pinned. Redirect count is bounded to five. A
redirect to localhost, cloud metadata space, a private address, credentials,
or a custom port fails before the next request.

Validating every returned DNS answer prevents a public/private mixed response
from selecting a dangerous fallback. Pinning the socket prevents a second
lookup from changing the address after validation.

## Production composition and degraded behavior

`createNodePublicSourceMetadataResolver` composes the hardened transport with
the deterministic source resolver. The V1 executor registry can use that
composition only through an explicit `publicMetadataProbe` option. Existing
tests and controlled transports can continue injecting the narrower resolver
port.

`AFTERFRAME_SOURCE_METADATA_PROBE_ENABLED=false` is the default. With the
switch off, the adapter performs no DNS or HTTP work and the resolver returns a
durable unresolved decision. DNS failures, cancellation, timeout, invalid
redirects, malformed responses, and socket failures likewise degrade to an
unresolved candidate; they cannot create source authority or evidence.

## Verification

Deterministic tests cover:

- public IPv4 and IPv6 admission plus special-use range rejection;
- mixed public/private DNS responses;
- redirect-to-private-network and metadata-service defenses;
- redirect budget, missing locations, explicit ports, and non-navigation 3xx;
- DNS resolution and IP pinning on every redirect;
- caller cancellation and one deadline across the full probe;
- body-free `HEAD`, no connection pooling, fixed minimal headers, bounded
  headers, TLS SNI/certificate policy, and malformed content length handling;
- stable failures that do not expose upstream details;
- explicit production-registry composition and the disabled-by-default server
  environment contract.

No external network or paid-model call is required for this test suite.

## Honest boundary

This checkpoint verifies public source identity metadata only. It does not
download, parse, quote, summarize, or promote source content. It does not
produce a paragraph, page, timestamp, transcript cue, screenplay scene, or
film-cut locator. `SOURCE_ONLY`, `LINK_ONLY`, `UNTRUSTED_SOURCE_DATA`, and
`NOT_EVIDENCE` remain enforced.

## Next gate

Checkpoint 04D begins lawful hostile-input retrieval and normalization. It must
introduce medium-specific adapters, rights and access decisions, byte and
decompression limits, content-type verification, immutable source snapshots,
prompt-injection isolation, parser provenance, and exact locator proposals.
Nothing retrieved may become evidence until later locator verification,
semantic support, independence, contradiction, and claim-policy gates pass.
