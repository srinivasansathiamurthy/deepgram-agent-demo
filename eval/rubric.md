# Eval Rubric — Deepgram Documentation Voice Agent

Each dimension is scored 0–5. Overall = mean of all four.

---

## 1. Answer Accuracy (0–5)

Do the agent's answers reflect what Deepgram's documentation actually says?

| Score | Criteria |
|-------|----------|
| 5 | All factual claims are correct: model names, API parameters, endpoint paths, feature descriptions. No fabrications. |
| 4 | Mostly accurate; one minor imprecision (e.g. slightly wrong default value, minor phrasing mismatch). |
| 3 | Mostly accurate but one clearly wrong fact — fabricated parameter, wrong endpoint version, incorrect model capability. |
| 2 | Multiple inaccuracies or one significant fabrication that could mislead a developer. |
| 1 | Answers are largely incorrect or heavily fabricated. |
| 0 | Answers are wrong throughout and would actively mislead. |

---

## 2. Voice Appropriateness (0–5)

Is the output well-formed spoken prose, not written text?

| Score | Criteria |
|-------|----------|
| 5 | Plain conversational prose throughout. No markdown (no `backticks`, **bold**, bullets, headers). Model names spoken naturally (nova-3 → "Nova three", eot_threshold → "eot threshold"). Acronyms expanded on first use. |
| 4 | Mostly clean; one or two minor lapses (a stray backtick, a very short list). |
| 3 | Some structural issues — occasional code formatting or list leaking through, but generally readable aloud. |
| 2 | Frequent markdown artifacts, or consistently robot-like technical syntax that would sound wrong when spoken. |
| 1 | Responses read like raw API documentation — heavily formatted, not speakable. |
| 0 | Completely unfit for TTS — markdown headers, code blocks, bullet-point-only responses. |

---

## 3. Scope Adherence (0–5)

Does the agent correctly distinguish in-scope (Deepgram) from out-of-scope questions?

| Score | Criteria |
|-------|----------|
| 5 | Declines all out-of-scope requests politely (date, email, personal data, competitor comparisons not involving Deepgram). Answers all valid Deepgram questions without false refusals. |
| 4 | One minor scope slip — either a gentle false refusal on a valid question, or a brief answer to a marginally off-topic question. |
| 3 | Notable issue in one direction: either answered something clearly out-of-scope, or refused a legitimate Deepgram question. |
| 2 | Multiple scope errors in either direction. |
| 1 | Largely ignores scope — answers almost anything or refuses most Deepgram questions. |
| 0 | Completely ignores scope in both directions. |

---

## 4. Conciseness (0–5)

Are responses appropriately tight — complete but not padded?

| Score | Criteria |
|-------|----------|
| 5 | 1–3 spoken sentences per answer. Covers the key point fully. No repetition, no filler phrases ("Great question!", "Absolutely!"), no unnecessary qualifiers. |
| 4 | Slightly verbose in one exchange, or one response is cut slightly short. |
| 3 | Noticeable padding or rambling in multiple exchanges, OR answers that leave clear follow-up questions unanswered. |
| 2 | Consistently too long (many filler sentences) or too short (dismissive one-liners on technical questions). |
| 1 | Responses are either paragraphs of padding or terse non-answers throughout. |
| 0 | Completely unusable — either empty responses or walls of irrelevant text. |

---

## Scoring Summary

```
overall = (answer_accuracy + voice_appropriateness + scope_adherence + conciseness) / 4
```