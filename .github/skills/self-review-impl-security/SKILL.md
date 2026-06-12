---
name: self-review-impl-security
description: Authoritative tier + prompt-pack handoff for the Security persona-switch self-critique round in the IMPLEMENTATION phase. PURE data; the Security persona reasoning is in the implementation-agent's prompt. Returns the OKR's frozen governanceTier (passed in from the landing-issue Hatter Tag) + computed max_auto_rounds + should_proceed gate + the security-review.md prompt pack contents read from .cheshire/prompts/implementation/ in the target repo.
version: 0.1.0
purity: pure-data
runtime: research-runner
command: npx @maintainabilityai/research-runner@~0.1.64 skill-self-review-impl-security
---

# Self-Review Impl Security Skill

Sibling of `self-review-impl-architect` — same shape, Security persona. The implementation-agent calls this skill once per round (per the `implementation-agent.agent.md` contract) before writing the `### Self-review — Security (round <N>)` block. No LLM inside — the agent does the actual reasoning.

## Why this skill exists (Codex-r4 Bug 2)

See `self-review-impl-architect`'s SKILL.md for the full rationale. Short version: the WHAT-phase `self-review-code-security` skill reads mesh state (`okrs/<id>/okr.yaml` + `actions[]` lookup) and fails in the target-repo / `IMPL-*`-runId context. This skill replaces it for the implementation phase.

## Inputs (stdin JSON)

Same as `self-review-impl-architect`:

| Field | Type | Required | Description |
|---|---|---|---|
| `okrId` | `string` | yes | The OKR id, for labeling. |
| `runId` | `string` | yes | **MUST start with `IMPL-`.** |
| `round` | `integer` | yes | The round number (1, 2, 3 — bounded by `max_auto_rounds`). |
| `tier` | `string` | yes | Authoritative governance tier from the landing issue's Hatter Tag continuation. |

## Outputs (stdout JSON)

Same shape as `self-review-impl-architect`. Differences:

| Field | Value |
|---|---|
| `persona` | `"impl-security"` |
| `promptPackPath` | `<repo>/.cheshire/prompts/implementation/security-review.md` |

`payload` emitted into the audit chain (via `auditMetadata`): `{persona, phase, tier, max_auto_rounds, round, should_proceed, prompt_pack_path, prompt_pack_found}`.

## Invocation

```sh
echo '{"okrId":"OKR-X","runId":"IMPL-2026-05-28-celeb-api-abc123","round":1,"tier":"supervised"}' \
  | npx -y @maintainabilityai/research-runner@~0.1.64 skill-self-review-impl-security
```

## Error contract

Same as `self-review-impl-architect`. `{ok: false, reason: 'runid-not-impl: ...'}` when the run id does not start with `IMPL-`.
