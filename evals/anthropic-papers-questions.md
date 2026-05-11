# anthropic-papers — curated demo questions

A hand-picked set of chat prompts for the Anthropic-papers wiki. Each one
exercises a different part of the chat path (single-page drill-down,
cross-paper synthesis, the new `searchSources` fallback, follow-up
pronoun resolution, the off-topic graceful-mismatch branch). Copy any of
them straight into the chat dock, or hand the question to
`evals/probe-chat.ts` to get an SSE-event trace.

Target wiki (prod): `c6379e8e-e2d5-4a66-ba0f-d66d3d8e5a34`
(30 pages — Sleeper Agents, Alignment Faking, Constitutional AI,
Many-shot Jailbreaking, H-RLHF preference models, plus the Phenomenons /
Findings / Evaluations / Techniques that thread them together.)

```sh
# Probe one question end-to-end against prod, printing every SSE event:
NODE_TLS_REJECT_UNAUTHORIZED=0 bun run evals/probe-chat.ts \
  "Compare the threat models in Sleeper Agents vs Alignment Faking."
```

For machine-scored runs against expected page-title fragments, citation
counts, and artifact kinds, see `anthropic-papers-cases.ts` +
`run-evals.ts`. This file is the human-readable counterpart: prompts
worth demoing, organized by what they push on.

---

## Concept drill-down (single page)

Tests `searchWiki` → `readWikiPage` and the synth's "open with prose,
close with prose" rhythm. Each should produce 1–3 citations.

1. **What is alignment faking, and when does it show up?**
2. **What's the core finding from Sleeper Agents?**
3. **How does Constitutional AI work, end to end?**
4. **What is many-shot jailbreaking?**
5. **What is "deceptive instrumental alignment"?**
6. **What's a Good-for-Humanity preference model (GfH PM)?**
7. **What does "specification gaming" mean in this corpus?**
8. **What is "model poisoning" and how do the papers frame it?**

## Numerical / specific claim extraction (KeyMetric / Quote)

Should fire a `KeyMetric` or `Quote` artifact — the synth's hint for
"single headline number" / "verbatim phrasing worth lifting."

9. **How many shots does many-shot jailbreaking typically need to break safety training?**
10. **What's the headline compliance-gap number for Claude 3 Opus on harmful queries?**
11. **What does the H-RLHF paper find when preference models are trained on a mixture of helpfulness and harmlessness data?**
12. **What's the measured effect of RL training on alignment-faking reasoning?**

## Categorical retrieval ("which X in this corpus…")

Pushes the agent to scan rather than drill. Should produce a
`ComparisonTable` listing the matches.

13. **Which papers in this corpus introduce a new attack technique?**
14. **List every Finding the corpus records about alignment-faking and what each one shows.**
15. **Which Evaluations does the corpus describe, and what does each measure?**
16. **Which Models does the corpus name, and what role does each play?**

## Cross-paper synthesis / compare-and-contrast

Forces the agent to retrieve ≥2 pages from different papers, then asks
the synth to spell out the relationship. Expect `ComparisonTable` or
`Timeline`.

17. **Compare the threat models in Sleeper Agents vs Alignment Faking in Large Language Models.**
18. **Trace the deception thread across the corpus — which papers contribute and what each adds.**
19. **How does the original Constitutional AI paper differ from the Specific-vs-General Principles follow-up?**
20. **How do the Constitutional AI techniques relate to the H-RLHF preference-model training described elsewhere in the corpus?**

## Should hit the `searchSources` fallback

The user's phrasing uses vocabulary the compiled page titles/bodies
don't repeat verbatim — the agent has to fall through from `searchWiki`
to `searchSources`, find token matches in the raw PDF text, then drill
back into the citing pages.

21. **What does this corpus say about deceptive AI behavior?**
    (Page titles say "alignment faking" / "deceptive instrumental alignment"; the
    string "deceptive AI behavior" lives in the source PDFs, not the compiled bodies.)
22. **Does the corpus describe any way a model could hide misalignment during evaluation?**
23. **What threats does the corpus identify around models pretending to be aligned?**
24. **Anything about safety training surviving fine-tuning attacks?**

## Follow-up / pronoun resolution (ask in sequence)

Tests the synth's history threading — the second question only resolves
against the prior turn.

25. *(turn 1)* **What's the core threat in Sleeper Agents?**
    *(turn 2)* **How does that paper define safety training, exactly?**
26. *(turn 1)* **Compare Sleeper Agents and Alignment Faking.**
    *(turn 2)* **Which of the two is more empirically grounded?**
27. *(turn 1)* **What is Constitutional AI?**
    *(turn 2)* **And the 2023 follow-up — what did it change?**

## Off-topic / graceful mismatch

The agent should NOT invent citations. The synth's empty-findings
branch should pivot to a `ComparisonTable` of follow-up suggestions
drawn from `listSamplePages`.

28. **What does this corpus say about quantum chromodynamics?**
29. **Does the wiki cover supply-chain attacks on training data?**
30. **hi**
    (one-word non-question — should land on the same empty-findings branch.)
