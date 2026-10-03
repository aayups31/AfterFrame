import { createHash } from "node:crypto";
import { createPrepareEvidencePassageService } from "@/application/research/prepare-evidence-passage";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";
import { SupabaseSourceRetrievalPersistence } from "@/infrastructure/persistence/supabase-source-retrieval-persistence";
import { SupabaseExactLocatorVerificationPersistence } from "@/infrastructure/persistence/supabase-exact-locator-verification-persistence";
import { SupabaseSourceNormalizationPersistence } from "@/infrastructure/persistence/supabase-source-normalization-persistence";
import { SupabasePdfNormalizationPersistence } from "@/infrastructure/persistence/supabase-pdf-normalization-persistence";
import { DeterministicHostileDocumentNormalizer } from "@/infrastructure/research/deterministic-hostile-document-normalizer";
import { PdfJsHostileDocumentExtractor } from "@/infrastructure/research/pdfjs-hostile-document-extractor";
import { DeterministicExactLocatorVerifier } from "@/infrastructure/research/deterministic-exact-locator-verifier";

/** Server composition only. Uses the caller's authenticated actor-scoped RPC
 * transport and already retrieved bytes; does not fetch URLs or call models. */
export function createPostgresEvidencePassageService(options: Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
}>) {
  const webNormalizer = new DeterministicHostileDocumentNormalizer();
  const pdfExtractor = new PdfJsHostileDocumentExtractor();
  return createPrepareEvidencePassageService({
    ...options,
    contextReader: new SupabaseSourceRetrievalPersistence(options),
    locatorReader: new SupabaseExactLocatorVerificationPersistence(options),
    webReader: new SupabaseSourceNormalizationPersistence(options),
    pdfReader: new SupabasePdfNormalizationPersistence(options),
    webNormalizer, pdfExtractor,
    verifier: new DeterministicExactLocatorVerifier({ webNormalizer, pdfExtractor }),
    fingerprint: (value) => createHash("sha256").update(value).digest("hex"),
    now: () => new Date().toISOString(),
    monotonicNow: () => performance.now(),
  });
}
