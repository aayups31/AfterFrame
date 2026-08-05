export const MODEL_POLICY = {
  orchestrator: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.6",
  verifier: process.env.OPENAI_VERIFIER_MODEL ?? "gpt-5.6",
  closure: process.env.OPENAI_CLOSURE_MODEL ?? "gpt-5.6",
  boundedWorker: process.env.OPENAI_WORKER_MODEL ?? "gpt-5.6-terra",
  defaultReasoningEffort: "medium",
  highStakesReasoningEffort: "high",
} as const;

export const AUTONOMY_POLICY = {
  maySearch: true,
  mayCreateProvisionalBranches: true,
  mayAcceptUserTheory: false,
  mayCloseInvestigation: false,
  mayPublish: false,
  mayPurchaseAccess: false,
  mayBypassAccessControls: false,
} as const;
