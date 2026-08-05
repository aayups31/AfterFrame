# 19 — Theory Engine

## Purpose

A theory branch begins with the user’s thought, not the agent’s conclusion. The system helps strengthen, weaken, split, or reframe it through evidence.

## Input example

> “I think the hotel is not creating Jack’s violence. It is amplifying what was already there.”

The engine stores the sentence exactly as the user wrote it and derives a separate machine representation.

## Theory decomposition

Create:

- the central proposition;
- implied subclaims;
- required observations;
- possible falsifiers;
- alternative explanations;
- relevant scenes and source classes;
- ambiguity that cannot be resolved by available evidence.

Never overwrite the original theory with the normalized version.

## Evidence lanes

Every theory branch should visibly distinguish:

### Supports

Evidence that becomes more likely or more coherent if the theory is true.

### Pressures

Evidence that creates tension without directly disproving it.

### Contradicts

Evidence incompatible with a material subclaim.

### Alternatives

Different explanations that account for the same observations.

### Unknowns

Questions for which the available sources are insufficient.

## Support states

Prefer calibrated language over fake precision:

- `STRONG` — several independent, high-quality lines of evidence support the theory and material counterevidence is addressed;
- `PLAUSIBLE` — meaningful support exists, but alternatives remain comparably viable;
- `FRAGILE` — the theory relies on one ambiguous pattern, dependent sources, or a key unsupported assumption;
- `UNDERDETERMINED` — the film or available record supports multiple readings without resolving them;
- `UNSUPPORTED` — research did not find meaningful support;
- `CONTRADICTED` — strong evidence conflicts with a necessary claim.

Interpretive theories should rarely receive numeric percentages. If numerical confidence is used internally, do not expose it as scientific certainty.

## Human response calibration

After verification, the investigator may say:

- Strong: “You might genuinely be onto something. The film, the screenplay, and two production sources line up.”
- Plausible: “There’s a real thread here. It works, but one alternative reading is just as strong.”
- Fragile: “I found the pattern, but it leans heavily on one assumption.”
- Underdetermined: “The evidence supports the reading, but the film seems built to keep both answers alive.”
- Unsupported: “I chased it. I can’t find enough to make it hold yet.”
- Contradicted: “This runs into a direct problem in the later scene and the revised script.”

The response must be derived from the assessment record, not improvised for excitement.

## Branch operations

- `STRENGTHEN` — seek better support and primary material;
- `CHALLENGE` — actively search for counterevidence;
- `SPLIT` — separate a broad theory into testable children;
- `REFRAME` — preserve the insight while changing the claim;
- `COMPARE` — evaluate against another theory;
- `MERGE` — combine compatible theories with user approval;
- `ARCHIVE` — keep a weak theory as part of the journey without presenting it as accepted.

## Bias controls

The theory engine must counter confirmation bias by:

- running at least one adversarial search;
- looking for negative cases;
- weighting source independence;
- checking whether the claimed motif appears in unrelated scenes;
- distinguishing creator intent from valid audience interpretation;
- preserving the user’s rejected and revised theories for provenance;
- not rewarding a theory merely because it is novel or emotionally satisfying.

## Theory assessment record

```text
id
branch_id
user_theory_text
normalized_proposition
support_state
support_summary
pressure_summary
contradiction_summary
alternative_explanations[]
unknowns[]
supporting_claim_ids[]
contradicting_claim_ids[]
assessment_model
assessment_prompt_version
assessed_at
```
