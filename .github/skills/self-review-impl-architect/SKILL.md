---
name: self-review-impl-architect
description: Authoritative tier + prompt-pack handoff for the Architect persona-switch self-critique round in the IMPLEMENTATION phase. PURE data; the Architect persona reasoning is in the implementation-agent's prompt. Returns the OKR's frozen governanceTier (passed in from the landing-issue Hatter Tag) + computed max_auto_rounds + should_proceed gate + the architect-review.md prompt pack contents read from .cheshire/prompts/implementation/ in the target repo.
version: 0.1.0
purity: pure-data
runtime: research-runner
command: npx @maintainabilityai/research-runner@~0.1.64 skill-self-review-impl-architect
---

# Self-Review Impl Architect Skill

Hands the implementation-agent the **authoritative inputs** for the Architect persona's self-critique step. The agent MUST call this skill once per round (per the `implementation-agent.agent.md` contract) before writing the `### Self-review — Architect (round <N>)` block. No LLM inside — the agent does the actual reasoning.

## Why this skill exists (Codex-r4 Bug 2)

The implementation-agent template originally told the agent to call `self-review-code-architect` (the WHAT phase skill). That skill reads the mesh's `okrs/<id>/okr.yaml` and looks up the `actions[]` entry by `runId` to source the authoritative `governanceTier`. The contract breaks for the implementation-agent because:

- The impl agent runs INSIDE the TARGET REPO (no `MESH_PATH`).
- The impl agent's `runId` is `IMPL-*` — not present in `okr.yaml`'s `actions[]` (those are WHY/HOW/WHAT run ids).

Calling `self-review-code-architect` from the target-repo context returns either `okr-not-found` (no mesh) or `action-not-found: no actions[] entry with runId=IMPL-...`. The audit chain would lack the self-review skill_call event entirely.

This skill mirrors the same data-only contract but adapts to the impl context:
- prompt pack is read from `<repo>/.cheshire/prompts/implementation/architect-review.md` (the Cheshire scaffold installs a starter pack on first fan-out into a target repo);
- `tier` is passed inline by the agent (the landing issue's Hatter Tag carries the OKR's frozen tier);
- the `runId` MUST start with `IMPL-` — defense-in-depth against accidental WHAT-phase routing (mirrors the audit-emit-event phase/runId guard, Codex-r4 Bug 3).

## Inputs (stdin JSON)

| Field | Type | Required | Description |
|---|---|---|---|
| `okrId` | `string` | yes | The OKR id, e.g. `OKR-2026Q2-IMDB-001-celeb-api`. Used for labeling — NOT to read mesh state. |
| `runId` | `string` | yes | **MUST start with `IMPL-`.** Your implementation_run_id. Anything else returns `runid-not-impl`. |
| `round` | `integer` | yes | The round number the agent is entering (1, 2, 3 — bounded by `max_auto_rounds`). |
| `tier` | `string` | yes | Authoritative governance tier from the landing issue's Hatter Tag continuation (`autonomous` / `supervised` / `restricted`). The OKR's frozen tier — do not infer this from any other source. |

## Outputs (stdout JSON)

| Field | Type | Description |
|---|---|---|
| `ok` | `boolean` | `true` on success. `false` with `reason` when `runId` does not start with `IMPL-`. |
| `persona` | `"impl-architect"` | Constant — confirms which skill ran. |
| `phase` | `"implementation"` | Constant — pins the phase for downstream UI/metric extractors. |
| `tier` | `"autonomous" \| "supervised" \| "restricted" \| "unknown"` | Echo of the input, lowercased. |
| `maxAutoRounds` | `integer` | Derived from `tier`: autonomous=3, supervised=2, restricted=0 (unknown→0). |
| `round` | `integer` | Echoes the input. |
| `shouldProceed` | `boolean` | `true` iff `tier != restricted` AND `round <= maxAutoRounds`. Use this to decide whether to write a `### Self-review — Architect (round N)` block or a `### Self-review — Skipped` block. |
| `promptPack` | `string` | Full text of `<repo>/.cheshire/prompts/implementation/architect-review.md`. Empty when the file isn't present (`promptPackFound: false`). |
| `promptPackPath` | `string` | Repo-relative path the skill read from. |
| `promptPackFound` | `boolean` | `true` if the prompt-pack file exists in the target repo. |

`payload` emitted into the audit chain (via `auditMetadata`): `{persona, phase, tier, max_auto_rounds, round, should_proceed, prompt_pack_path, prompt_pack_found}`. The full `promptPack` body is NOT in the chain (would bloat events) — only the path + presence flag.

## Invocation

```sh
echo '{"okrId":"OKR-X","runId":"IMPL-2026-05-28-celeb-api-abc123","round":1,"tier":"supervised"}' \
  | npx -y @maintainabilityai/research-runner@~0.1.64 skill-self-review-impl-architect
```

## Error contract

`{ok: false, reason: 'bad-input: ...'}` on schema failures (missing required fields). `{ok: false, reason: 'runid-not-impl: ...'}` when the run id does not start with `IMPL-` (the impl phase contract — pass `parent_run_id` to `self-review-code-architect` if you actually want the WHAT-phase skill).
