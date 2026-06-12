---
name: knowledge-code-read
description: Reads bounded file contents (≤10 KB) from the brownfield clone retained by knowledge-code. Lets the code-design-agent ground design with real code excerpts, not paraphrased guesses. Shares the session clone cache with knowledge-code — call knowledge-code first for the same repo.
version: 0.1.0
purity: pure-data
runtime: research-runner
command: npx @maintainabilityai/research-runner@~0.1.64 skill-knowledge-code-read
---

# Knowledge Code Read Skill

The code-design-agent (Phase D / WHAT) calls this **after** invoking
`knowledge-code` for the same brownfield repo, to read specific file
contents from the cached clone. Bug-Q phase 2 (Codex audit round 2)
introduced this skill to close the gap where `knowledge-code` returned
only structural metadata — leaving the agent to hallucinate file paths
and content while writing `code-design.md`.

The agent typically follows this pattern per brownfield repo:

1. `knowledge-code` once — clones + classifies, returns `files[]` /
   `routes[]` / `tests[]` / `modules[]` and a flat `inventory_paths`
   array in the audit payload.
2. `knowledge-code-read` N times — reads specific files from the
   inventory the agent wants to ground design decisions on. The
   per-run clone cache makes every read after the first ~free.

## Input

```json
{
  "okrId": "<okr-id>",
  "runId": "<run-id from session context>",
  "repoUrl": "https://github.com/owner/name",
  "ref": "main",
  "filePath": "src/api/users.ts"
}
```

- `okrId` (required) — OKR identity (audit metadata).
- `runId` (required, falls back to RUN_ID env var) — session identity;
  the cache key for the clone shared with knowledge-code.
- `repoUrl` (required) — GitHub HTTPS URL of the brownfield repo.
- `ref` (optional, defaults to HEAD) — branch / tag / SHA to clone.
- `filePath` (required) — repo-relative path. Must NOT be absolute and
  must NOT contain `..` segments. Resolved path must be a child of
  the cloned repo root; symlink-shaped escapes are rejected.

## Output

```json
{
  "ok": true,
  "repo": "owner/name",
  "file": "src/api/users.ts",
  "sha": "<resolved git SHA>",
  "content": "<file contents as utf-8 string, ≤10240 bytes>",
  "lang": "typescript",
  "lineCount": 42,
  "truncated": false,
  "bytesReturned": 1234,
  "bytesTotal": 1234,
  "auditMetadata": { ... }
}
```

- `content` — file contents, capped at 10 KB. Larger files are
  truncated; `truncated: true` signals the agent should call again
  with a narrower scope or accept the prefix.
- `lang` — best-effort language detection from the extension.
- `bytesReturned` / `bytesTotal` — let the agent decide whether the
  truncated prefix is sufficient.

## Failure modes

| `reason` | When | Remediation |
|---|---|---|
| `bad-input` | Zod validation failure | Check input shape; `runId` + `repoUrl` + `filePath` are required. |
| `repo-url-not-github` | URL is not `github.com` | Skill currently only supports GitHub URLs. |
| `missing-run-id` | No `runId` input AND no `RUN_ID` env var | Export the session context (`OKR_ID` / `RUN_ID` / `INTENT_THREAD_UUID` / `PHASE`) before invoking — see agent.md step 1b. |
| `path-rejected: absolute paths are forbidden` | filePath starts with `/` | Use a repo-relative path like `src/api/users.ts`. |
| `path-rejected: path-traversal segments forbidden` | filePath contains `..` | Use a path that stays inside the repo. |
| `path-escape` | Resolved real path escapes the clone (symlink shape) | The repo contains a symlink to a file outside its tree; the skill refuses for security. |
| `clone-failed` | git clone failed | Check that the GitHub App is installed on the repo. |
| `file-not-found` | Path doesn't exist in the clone | Check the inventory returned by `knowledge-code` for the correct path. |
| `path-is-directory` | filePath points at a directory | This skill returns file contents only — list directories via `knowledge-code` inventory. |
| `binary-file` | File contains NUL bytes in the first 8 KB | Binary files are refused; code-design-agent reads source, not blobs. |

## Audit chain

Every invocation auto-emits a `skill_call` event (B28 Court Recorder
Auto-Logging) with the file path + bytes returned + truncated flag.
The audit chain records exactly which files the agent consulted while
writing the design — reviewers can cross-check the design's brownfield
code excerpts against the chain to verify they came from real reads.
