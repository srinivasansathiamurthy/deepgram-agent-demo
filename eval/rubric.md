# Eval Rubric — Deepgram Documentation Voice Agent

## Methodology

Each eval run covers **N independent questions** drawn from `eval_questions.json` (up to 50; typically 20). Questions are fixed — the same set every run so results are comparable across iterations.

For each question, a control response and an experimental response are collected (one from each agent under test). A judge model (Claude) reads both responses and, for each rubric dimension, decides which agent won or whether it was a tie.

**Judgment options per dimension:** `control` | `experimental` | `tie`

There is no numeric score. The output is two vectors:

```
per_question[i]   ∈ {control, experimental, tie}   i = 1..N
per_dimension[d]  = {control: int, experimental: int, tie: int}  for each dimension d
```

`per_question[i]` is the overall winner for question i — the agent that won more dimensions,
or `tie` if even. In a true tie across all four dimensions, record `tie`.

---

## Rubric Dimensions

### 1. Answer Accuracy

Which response better reflects what Deepgram's documentation actually says?

- **control wins** — control's claims are correct; experimental has a factual error, fabricated parameter, wrong model name, or wrong endpoint.
- **experimental wins** — experimental is correct; control has the error.
- **tie** — both are equally accurate (both correct, or both make the same minor imprecision).

### 2. Voice Appropriateness

Which response sounds better when spoken aloud?

- Prefer plain conversational prose. No markdown artifacts (`backticks`, **bold**, bullets, headers). Model names spoken naturally ("Nova three", not "nova-3"). Acronyms expanded on first mention.
- **tie** — both are equally natural (or equally broken).

### 3. Scope Adherence

Which response better stays within Deepgram's domain?

- Penalize answers to out-of-scope questions (date, personal data, competitor-only comparisons).
- Penalize false refusals on valid Deepgram questions.
- **tie** — both handle scope equally well.

### 4. Conciseness

Which response is more appropriately tight — complete but not padded?

- Prefer 1–3 spoken sentences. No filler phrases ("Great question!", "Absolutely!"), no repetition, no unnecessary qualifiers.
- Penalize both verbosity and dismissive one-liners on technical questions.
- **tie** — both are comparably tight or comparably verbose.

---

## Output Format

```json
{
  "question_id": "q14",
  "question": "What does the FunctionCallRequest look like...",
  "control_response": "...",
  "experimental_response": "...",
  "dimensions": {
    "answer_accuracy":      "experimental",
    "voice_appropriateness": "tie",
    "scope_adherence":      "tie",
    "conciseness":          "control"
  },
  "overall": "tie"
}
```

Aggregate output across all N questions:

```json
{
  "n": 20,
  "summary": {
    "control":      7,
    "experimental": 10,
    "tie":           3
  },
  "by_dimension": {
    "answer_accuracy":       {"control": 5, "experimental": 11, "tie": 4},
    "voice_appropriateness": {"control": 8, "experimental":  7, "tie": 5},
    "scope_adherence":       {"control": 6, "experimental":  8, "tie": 6},
    "conciseness":           {"control": 9, "experimental":  6, "tie": 5}
  },
  "per_question": [
    {"id": "q01", "overall": "experimental"},
    {"id": "q02", "overall": "tie"},
    ...
  ]
}
```

---

## Judge Prompt Template

```
You are evaluating two voice agent responses to the same question about Deepgram's documentation.

Question: {question}

Control response: {control_response}

Experimental response: {experimental_response}

For each dimension below, output exactly one of: control, experimental, tie.
No explanations unless the caller requests them.

Dimensions:
1. answer_accuracy
2. voice_appropriateness
3. scope_adherence
4. conciseness
5. overall (the agent that won more dimensions; tie if even)

Respond as JSON matching this schema:
{"answer_accuracy": "...", "voice_appropriateness": "...", "scope_adherence": "...", "conciseness": "...", "overall": "..."}
```
