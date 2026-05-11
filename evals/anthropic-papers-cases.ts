/**
 * Eval cases targeting the curated Anthropic-papers wiki
 * (~/Downloads/tenex-anthropic-papers/, 10 PDFs spanning 2022–2024). Each
 * case names the question, the wiki-page titles the agent loop SHOULD
 * pull into context, the substrings the synth answer SHOULD contain, and
 * any artifact kinds we expect to see at least once.
 *
 * Matching is forgiving on purpose:
 *   - `expectedPageTitleFragments`: case-insensitive substring matches
 *     against the WikiPageRetrieved events. The agent gets credit if it
 *     pulled at least one page whose title contains a fragment.
 *   - `expectedAnswerSubstrings`: substring presence in the final
 *     concatenated answer text (prose + flattened artifact text). Use
 *     short, distinctive phrases (paper names, key numbers, technique
 *     names) — not full sentences.
 *   - `expectedArtifactKinds`: at least one Artifact of each named kind
 *     must show up. Empty array = no artifact requirement.
 *   - `minCitationCount`: at least N citation segments must reach the
 *     SSE tape. 0 = no citation requirement (rare; useful for empty-
 *     wiki / off-topic eval cases).
 *
 * The cases double as "really interesting prompts to demo with" — the
 * suggested prompts in tenex-anthropic-papers/README.md are mirrored
 * here so a passing eval run is also a curated demo script.
 */

export interface EvalCase {
  id: string;
  question: string;
  /** Why this question is interesting / what aspect of the agent it tests. */
  rationale: string;
  /** Substring fragments that should appear in at least one retrieved page title. */
  expectedPageTitleFragments: string[];
  /** Substring fragments the final answer text MUST contain. Case-insensitive. */
  expectedAnswerSubstrings: string[];
  /** Artifact kinds that must appear at least once. Empty = no requirement. */
  expectedArtifactKinds: ReadonlyArray<
    | 'ComparisonTable'
    | 'Timeline'
    | 'LineChart'
    | 'BarChart'
    | 'KeyMetric'
    | 'CodeBlock'
    | 'Quote'
    | 'Markdown'
  >;
  /** Minimum citation segments expected in the answer. */
  minCitationCount: number;
  /**
   * If set, ALL listed source filenames must show up at least once in the
   * citation set (matched against `Citation.label` and the underlying
   * source row). Use for cross-paper synthesis cases.
   */
  expectedSourceFilenameFragments?: string[];
}

export const ANTHROPIC_PAPERS_CASES: ReadonlyArray<EvalCase> = [
  {
    id: 'evolution-rlhf-to-cai',
    question:
      "How has Anthropic's view on RLHF evolved between the 2022 helpful-harmless paper and the 2022 Constitutional AI paper?",
    rationale:
      'Cross-paper synthesis. Forces the agent to retrieve from at least two PDFs and produce a Timeline (chronological) plus a Quote.',
    expectedPageTitleFragments: ['rlhf', 'constitutional', 'helpful', 'harmless'],
    expectedAnswerSubstrings: ['RLHF', 'Constitutional'],
    expectedArtifactKinds: ['Timeline'],
    minCitationCount: 2,
    expectedSourceFilenameFragments: ['rlhf-helpful-harmless', 'constitutional-ai'],
  },
  {
    id: 'introduces-new-benchmark',
    question: 'Which papers in this corpus introduce a new benchmark or evaluation methodology?',
    rationale:
      'Tests the agent\'s ability to scan the wiki for a category ("benchmark / eval methodology") rather than a named entity. Should produce a ComparisonTable.',
    expectedPageTitleFragments: ['eval', 'benchmark', 'method', 'model-written'],
    expectedAnswerSubstrings: ['model-written', 'evaluation'],
    expectedArtifactKinds: ['ComparisonTable'],
    minCitationCount: 2,
  },
  {
    id: 'sleeper-vs-alignment-faking',
    question:
      'Summarise the threat model in Sleeper Agents and how it differs from Alignment Faking.',
    rationale:
      'Cross-paper compare/contrast. Forces drill-down into two specific papers; tests the agent\'s ability to surface "differences" rather than just topical hits.',
    expectedPageTitleFragments: ['sleeper', 'alignment faking', 'deceptive'],
    expectedAnswerSubstrings: ['Sleeper', 'Alignment Faking'],
    expectedArtifactKinds: ['ComparisonTable'],
    minCitationCount: 2,
    expectedSourceFilenameFragments: ['sleeper-agents', 'alignment-faking'],
  },
  {
    id: 'many-shot-headline-number',
    question: "What's the headline number from the Many-shot Jailbreaking paper?",
    rationale:
      'Single-source numerical lookup. Should fire a KeyMetric artifact with a citation to the many-shot PDF.',
    expectedPageTitleFragments: ['many-shot', 'jailbreaking'],
    expectedAnswerSubstrings: ['many-shot'],
    expectedArtifactKinds: ['KeyMetric'],
    minCitationCount: 1,
    expectedSourceFilenameFragments: ['many-shot-jailbreaking'],
  },
  {
    id: 'induction-heads-mechanism',
    question: 'What are induction heads and why do they matter for in-context learning?',
    rationale:
      "Concept lookup that requires reading deeper into one paper. Tests the agent's drill-down ability — the title alone isn't enough; the answer needs internals.",
    expectedPageTitleFragments: ['induction', 'in-context'],
    expectedAnswerSubstrings: ['induction head', 'in-context'],
    expectedArtifactKinds: [],
    minCitationCount: 1,
    expectedSourceFilenameFragments: ['induction-heads'],
  },
  {
    id: 'superposition-feature-count',
    question:
      'What does Toy Models of Superposition say about the relationship between features and dimensions?',
    rationale:
      "Mechanistic interpretability question. Tests retrieval against an interpretability-flavored title plus the agent's ability to extract the right claim.",
    expectedPageTitleFragments: ['superposition', 'toy models'],
    expectedAnswerSubstrings: ['superposition', 'feature'],
    expectedArtifactKinds: [],
    minCitationCount: 1,
    expectedSourceFilenameFragments: ['superposition'],
  },
  {
    id: 'specific-vs-general-cai',
    question:
      'In the 2023 follow-up paper, what trade-off does Anthropic identify between specific and general principles for Constitutional AI?',
    rationale:
      'Tests temporal disambiguation — there are TWO Constitutional AI papers in the corpus and the agent has to pick the 2023 one. Also tests "trade-off" extraction.',
    expectedPageTitleFragments: ['specific', 'general', 'constitutional'],
    expectedAnswerSubstrings: ['specific', 'general'],
    expectedArtifactKinds: [],
    minCitationCount: 1,
    expectedSourceFilenameFragments: ['specific-vs-general-cai'],
  },
  {
    id: 'sycophancy-reward-tampering',
    question:
      'How does Sycophancy to Subterfuge characterise the progression from sycophancy to reward tampering?',
    rationale:
      'Tests narrative-progression extraction. The paper itself frames a progression, so the agent should pick that up rather than dumping unrelated facts.',
    expectedPageTitleFragments: ['sycophancy', 'subterfuge', 'reward'],
    expectedAnswerSubstrings: ['sycophancy', 'reward'],
    expectedArtifactKinds: [],
    minCitationCount: 1,
    expectedSourceFilenameFragments: ['sycophancy-to-subterfuge'],
  },
  {
    id: 'off-topic-graceful-mismatch',
    question: 'What does this corpus say about quantum chromodynamics?',
    rationale:
      "Off-topic gracefully-handled question. The agent should NOT invent a citation; the synth must explicitly name the mismatch and pivot to suggesting what the wiki actually covers (the synthesizer's built-in branch). Validates the empty-findings + suggestionPages fallback all the way through.",
    expectedPageTitleFragments: [],
    expectedAnswerSubstrings: ["doesn't", 'cover'],
    expectedArtifactKinds: ['ComparisonTable'],
    minCitationCount: 0,
  },
  {
    id: 'cross-corpus-deception-thread',
    question:
      'Trace the thread on deceptive AI behaviour across the corpus — which papers contribute and what each adds.',
    rationale:
      'Hardest case: requires the agent to recognise that Sleeper Agents, Alignment Faking, AND Sycophancy/Subterfuge all live on a "deception" thread. Should produce a Timeline ordered by year.',
    expectedPageTitleFragments: ['sleeper', 'alignment faking', 'sycophancy'],
    expectedAnswerSubstrings: ['Sleeper', 'Alignment Faking', 'Sycophancy'],
    expectedArtifactKinds: ['Timeline'],
    minCitationCount: 3,
    expectedSourceFilenameFragments: [
      'sleeper-agents',
      'alignment-faking',
      'sycophancy-to-subterfuge',
    ],
  },
];
