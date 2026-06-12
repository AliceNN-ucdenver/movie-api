#!/usr/bin/env node

/**
 * CodeQL SARIF Results Processor
 *
 * Processes CodeQL SARIF results into GitHub issues, then dispatches the
 * Alice maintenance agent (a custom Copilot persona) to remediate them.
 *
 * Cheshire v2: issues NO LONGER embed prompt-pack bodies or an @claude
 * remediation zone. The body names the flagged file + the local
 * `.cheshire/prompts/` packs + `.github/repo-metadata.yml`, and Alice reads
 * them herself and grounds the fix in the real code (no remote fetch, no
 * 65 KB truncation risk).
 */

const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  githubToken: process.env.GITHUB_TOKEN,
  severityThreshold: process.env.SEVERITY_THRESHOLD || 'high',
  maxIssuesPerRun: parseInt(process.env.MAX_ISSUES_PER_RUN || '10', 10),
  enableMaintainability: process.env.ENABLE_MAINTAINABILITY === 'true',
  enableThreatModel: process.env.ENABLE_THREAT_MODEL === 'true',
  autoAssign: (process.env.AUTO_ASSIGN || '').split(',').filter(Boolean),
  excludedPaths: (process.env.EXCLUDED_PATHS || '').split(',').filter(Boolean),
  // The custom Copilot persona dispatched to remediate each finding. Set by
  // the codeql-to-issues workflow; defaults to the scaffolded Alice agent.
  maintenanceAgent: process.env.MAINTENANCE_AGENT || 'alice-maintenance-agent',
  // Auto-dispatch Alice on new findings? Defaults to FALSE — issues are filed
  // unassigned and the user triggers Alice from the Security Scorecard.
  autoAssignAlice: process.env.AUTO_ASSIGN_ALICE === 'true',
  owner: process.env.GITHUB_REPOSITORY_OWNER || (process.env.GITHUB_REPOSITORY || '/').split('/')[0],
  repo: (process.env.GITHUB_REPOSITORY || '/').split('/')[1],
  sarifPath: process.env.SARIF_PATH || 'results.sarif',
  branch: process.env.GITHUB_REF_NAME || 'main',
  sha: process.env.GITHUB_SHA || 'unknown'
};

if (!config.githubToken) {
  console.error('ERROR: GITHUB_TOKEN environment variable is required');
  process.exit(1);
}

console.log('Configuration:');
console.log(`  Repository: ${config.owner}/${config.repo}`);
console.log(`  SARIF Path: ${config.sarifPath}`);
console.log(`  Severity Threshold: ${config.severityThreshold}`);
console.log(`  Max Issues Per Run: ${config.maxIssuesPerRun}`);

const octokit = new Octokit({ auth: config.githubToken });

// Load prompt mappings
const mappingsPath = path.join(__dirname, 'prompt-mappings.json');
let mappings;
try {
  mappings = JSON.parse(fs.readFileSync(mappingsPath, 'utf8'));
} catch (error) {
  console.error(`ERROR: Could not load prompt mappings from ${mappingsPath}:`, error.message);
  process.exit(1);
}

// ============================================================================
// LOGGING
// ============================================================================

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) { fs.mkdirSync(logsDir, { recursive: true }); }

const logFile = path.join(logsDir, 'processing.log');
const summaryFile = path.join(logsDir, 'summary.json');

function log(level, message, metadata = {}) {
  const timestamp = new Date().toISOString();
  const sanitized = String(message).replace(/[\x00-\x1F\x7F-\x9F]/g, '').substring(0, 500).trim();
  fs.appendFileSync(logFile, JSON.stringify({ timestamp, level, message: sanitized, ...metadata }) + '\n');
  const prefix = { INFO: 'i', WARN: '!', ERROR: 'x', SUCCESS: '+' }[level] || '-';
  console.log(`[${prefix}] ${sanitized}`);
}

// ============================================================================
// SOURCE SNIPPET EXTRACTION
// ============================================================================

/**
 * Read source lines from the checked-out repo when SARIF doesn't include a snippet.
 * Returns the relevant lines with 2 lines of context above and below, or '' if unreadable.
 */
function extractSnippetFromFile(filePath, startLine, endLine) {
  // SARIF paths may be relative or use forward slashes
  const normalized = filePath.replace(/^\/+/, '');
  const candidates = [normalized, path.resolve(normalized)];
  // Also try relative to GITHUB_WORKSPACE if set
  if (process.env.GITHUB_WORKSPACE) {
    candidates.push(path.join(process.env.GITHUB_WORKSPACE, normalized));
  }

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) { continue; }
      const lines = fs.readFileSync(candidate, 'utf8').split('\n');
      const contextLines = 2;
      const from = Math.max(0, startLine - 1 - contextLines);
      const to = Math.min(lines.length, endLine + contextLines);
      const extracted = [];
      for (let i = from; i < to; i++) {
        const lineNum = i + 1;
        const marker = (lineNum >= startLine && lineNum <= endLine) ? '>' : ' ';
        extracted.push(`${marker} ${String(lineNum).padStart(4)} | ${lines[i]}`);
      }
      return extracted.join('\n');
    } catch { /* try next candidate */ }
  }
  return '';
}

// ============================================================================
// SARIF PARSING
// ============================================================================

function parseSARIFResults(sarifPath) {
  if (!fs.existsSync(sarifPath)) {
    log('ERROR', `SARIF file not found: ${sarifPath}`);
    return [];
  }
  let sarif;
  try {
    sarif = JSON.parse(fs.readFileSync(sarifPath, 'utf8'));
  } catch (error) {
    log('ERROR', `Failed to parse SARIF: ${error.message}`);
    return [];
  }

  const vulnerabilities = [];
  for (const run of sarif.runs || []) {
    const tool = run.tool?.driver?.name || 'CodeQL';
    const toolVersion = run.tool?.driver?.semanticVersion || 'unknown';
    const rulesCount = run.tool?.driver?.rules?.length || 0;
    log('INFO', `SARIF run: tool=${tool} v${toolVersion} | rules defined: ${rulesCount} | results: ${(run.results || []).length}`);

    // Dump available rule IDs for debugging
    if (rulesCount > 0) {
      const ruleIds = run.tool.driver.rules.map(r => r.id);
      log('INFO', `  Available rule IDs: ${ruleIds.join(', ')}`);
      // Log first rule's full structure to understand the schema
      const sampleRule = run.tool.driver.rules[0];
      log('INFO', `  Sample rule structure: ${JSON.stringify({ id: sampleRule.id, properties: sampleRule.properties, hasShortDesc: !!sampleRule.shortDescription }, null, 0).substring(0, 400)}`);
    } else {
      log('WARN', '  No rules array in SARIF — security-severity scores will be unavailable');
      // Check if rules are in extensions instead
      const extensions = run.tool?.extensions || [];
      if (extensions.length > 0) {
        log('INFO', `  Found ${extensions.length} tool extension(s) — checking for rules there`);
        for (const ext of extensions) {
          const extRules = ext.rules || [];
          if (extRules.length > 0) {
            log('INFO', `    Extension "${ext.name}": ${extRules.length} rules`);
            const sample = extRules[0];
            log('INFO', `    Sample: ${JSON.stringify({ id: sample.id, properties: sample.properties }, null, 0).substring(0, 400)}`);
          }
        }
      }
    }

    // Build a lookup that checks both driver.rules AND extensions.rules
    const ruleIndex = new Map();
    for (const r of run.tool?.driver?.rules || []) { ruleIndex.set(r.id, r); }
    for (const ext of run.tool?.extensions || []) {
      for (const r of ext.rules || []) { ruleIndex.set(r.id, r); }
    }
    if (ruleIndex.size > 0 && rulesCount === 0) {
      log('INFO', `  Built rule index from extensions: ${ruleIndex.size} rules`);
    }

    for (const result of run.results || []) {
      const location = result.locations?.[0]?.physicalLocation;
      if (!location) { continue; }
      const rule = ruleIndex.get(result.ruleId) || null;
      const level = result.level || 'warning';

      // Severity: prefer the numeric security-severity score from CodeQL rule properties.
      // This matches what GitHub's Code Scanning UI displays.
      // Only fall back to SARIF level mapping when no numeric score is available.
      const secScore = parseFloat(rule?.properties?.['security-severity'] || '');
      const SARIF_LEVEL_SEV = { error: 'critical', warning: 'high', note: 'medium', none: 'low' };
      const severity = !isNaN(secScore) ? numericToSeverity(secScore) : (SARIF_LEVEL_SEV[level] || 'medium');

      // Detailed logging for debugging severity classification
      log('INFO', `  Rule: ${result.ruleId} | Level: ${level} | security-severity: ${isNaN(secScore) ? '(none)' : secScore} | Resolved: ${severity} | File: ${location.artifactLocation?.uri || 'unknown'}`);
      if (rule) {
        log('INFO', `    Rule tags: ${(rule.properties?.tags || []).join(', ') || '(none)'}`);
        log('INFO', `    Rule precision: ${rule.properties?.precision || '(none)'} | kind: ${rule.properties?.kind || result.kind || '(none)'}`);
      } else {
        log('WARN', `    Rule "${result.ruleId}" NOT found in driver.rules or extensions — no severity score available`);
      }

      const filePath = location.artifactLocation?.uri || 'unknown';
      const startLine = location.region?.startLine || 1;
      const endLine = location.region?.endLine || location.region?.startLine || 1;
      // Prefer SARIF-embedded snippet, fall back to reading the source file
      let codeSnippet = location.region?.snippet?.text || '';
      if (!codeSnippet && filePath !== 'unknown') {
        codeSnippet = extractSnippetFromFile(filePath, startLine, endLine);
        if (codeSnippet) {
          log('INFO', `    Extracted snippet from source file for ${filePath}:${startLine}`);
        }
      }

      vulnerabilities.push({
        ruleId: result.ruleId,
        ruleName: rule?.shortDescription?.text || result.ruleId,
        ruleHelp: rule?.help?.text || '',
        message: result.message?.text || '',
        level,
        severity,
        securityScore: isNaN(secScore) ? null : secScore,
        filePath,
        startLine,
        endLine,
        codeSnippet,
        tool, toolVersion
      });
    }
  }
  log('SUCCESS', `Parsed ${vulnerabilities.length} vulnerabilities from SARIF`);
  return vulnerabilities;
}

// ============================================================================
// OWASP MAPPING & GROUPING
// ============================================================================

function mapToOWASP(ruleId) {
  const owaspKey = mappings.codeql_to_owasp[ruleId];
  if (!owaspKey) { return null; }
  return { key: owaspKey, ...mappings.owasp_categories[owaspKey] };
}

function groupFindingsByRuleAndFile(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.ruleId}:${f.filePath}`;
    if (!groups.has(key)) {
      groups.set(key, { ...f, occurrences: [] });
    }
    groups.get(key).occurrences.push({
      startLine: f.startLine, endLine: f.endLine, codeSnippet: f.codeSnippet, message: f.message
    });
  }
  return Array.from(groups.values());
}

// Map numeric security-severity score to severity label (CVSS bands)
function numericToSeverity(score) {
  if (score >= 9.0) { return 'critical'; }
  if (score >= 7.0) { return 'high'; }
  if (score >= 4.0) { return 'medium'; }
  return 'low';
}


function meetsSeverityThreshold(severity) {
  const levels = ['low', 'medium', 'high', 'critical'];
  return levels.indexOf(severity) >= levels.indexOf(config.severityThreshold);
}

// ============================================================================
// ISSUE BODY & TITLE
// ============================================================================

function createIssueTitle(g) {
  const fileName = path.basename(g.filePath);
  const count = g.occurrences.length;
  return `[Security] ${g.ruleName} in ${fileName} (${count} occurrence${count > 1 ? 's' : ''})`;
}

function createIssueBody(g, prompts) {
  const timestamp = new Date().toISOString();
  const count = g.occurrences.length;
  const ext = path.extname(g.filePath).toLowerCase();
  const lang = { '.js': 'javascript', '.ts': 'typescript', '.py': 'python' }[ext] || 'text';

  let body = `## Security Vulnerability: ${g.ruleName}\n\n`;
  body += `**Detected by**: ${g.tool} v${g.toolVersion}\n**Created**: ${timestamp}\n**Occurrences**: ${count}\n\n---\n\n`;
  body += `| Property | Value |\n|----------|-------|\n`;
  body += `| **Severity** | ${g.severity.toUpperCase()} |\n`;
  body += `| **CodeQL Rule** | \`${g.ruleId}\` |\n`;
  body += `| **OWASP** | ${prompts.owaspCategory || 'Unknown'} |\n`;
  body += `| **File** | \`${g.filePath}\` |\n\n`;

  g.occurrences.forEach((occ, i) => {
    body += `#### ${count > 1 ? `Location ${i+1}: ` : ''}Lines ${occ.startLine}${occ.endLine !== occ.startLine ? '-'+occ.endLine : ''}\n\n`;
    body += `\`\`\`${lang}\n${occ.codeSnippet || '(No snippet)'}\n\`\`\`\n\n**Issue**: ${occ.message}\n\n`;
  });

  // task-kind label so the Alice persona routes this to its codeql-finding flow.
  body += `**Task kind**: \`codeql-finding\`\n\n`;

  // Grounding — Alice reads the packs + repo-metadata + the real code herself.
  // We REFERENCE the local packs by path; we never embed their bodies (avoids
  // the 65 KB issue-truncation risk and keeps the agent reading source-of-truth).
  body += `---\n\n## Remediation — grounded in this repo\n\n`;
  body += `Before changing anything, read (do not assume):\n\n`;
  body += `1. \`.github/repo-metadata.yml\` — the language, test runner, and conventions of this repo.\n`;
  body += `2. The flagged file itself, **\`${g.filePath}\`**, plus its callers and tests.\n`;
  body += `3. The security packs that apply to this finding (the methodology, not boilerplate):\n`;
  if (prompts.owaspKey && prompts.owaspKey !== 'unmapped') {
    body += `   - \`.cheshire/prompts/owasp/${prompts.owaspKey}.md\` — OWASP guidance for this category\n`;
  }
  body += `   - \`.cheshire/prompts/default.md\` — security-first baseline (always applies)\n`;
  body += `   - \`.cheshire/prompts/maintainability/maintainability.md\` — maintainability guidance\n`;
  body += `   - \`.cheshire/prompts/threat-modeling/stride.md\` — STRIDE threat analysis\n\n`;
  body += `Then fix all ${count} occurrence${count > 1 ? 's' : ''} in \`${g.filePath}\`, name the real files/functions you touched, and open a PR whose first line is \`Closes #<this issue>\`. Do not add mocks, disable tests, or weaken the check to pass — your changes are governed by the baked Red Queen policy + PreToolUse hook.\n\n`;

  // Metadata
  body += `<details>\n<summary>Additional Metadata</summary>\n\n`;
  body += `- **Tool**: ${g.tool} v${g.toolVersion}\n`;
  body += `- **Repository**: ${config.owner}/${config.repo}\n`;
  body += `- **Branch**: ${config.branch}\n`;
  body += `- **Commit**: ${config.sha}\n\n</details>\n`;

  return body.length > 65000 ? body.substring(0, 65000) + '\n\n(truncated)' : body;
}

// ============================================================================
// ISSUE CREATION / DEDUP / AUTO-CLOSE
// ============================================================================

async function findExistingIssue(g) {
  try {
    const { data: issues } = await octokit.rest.issues.listForRepo({
      owner: config.owner, repo: config.repo, labels: 'codeql-finding', state: 'open', per_page: 100
    });
    for (const issue of issues) {
      const body = issue.body || '';
      if (body.includes(`\`${g.ruleId}\``) && body.includes(`\`${g.filePath}\``)) {
        return issue;
      }
    }
  } catch {}
  return null;
}

function generateLabels(g, owaspInfo) {
  const labels = ['codeql-finding'];
  if (mappings.label_mapping[g.severity]) { labels.push(mappings.label_mapping[g.severity]); }
  if (owaspInfo?.key) { labels.push(`owasp/${owaspInfo.key.toLowerCase()}`); }
  labels.push('awaiting-remediation-plan');
  return labels;
}

let cachedDefaultBranch = null;
async function getDefaultBranch() {
  if (cachedDefaultBranch) { return cachedDefaultBranch; }
  try {
    const { data } = await octokit.rest.repos.get({ owner: config.owner, repo: config.repo });
    cachedDefaultBranch = data.default_branch || 'main';
  } catch { cachedDefaultBranch = 'main'; }
  return cachedDefaultBranch;
}

/**
 * Dispatch the Alice maintenance agent (a custom Copilot persona) to remediate
 * a freshly-created finding. Mirrors the extension's assignCustomCopilotAgent:
 * the `agent_assignment` extension on the assignees endpoint flips the issue to
 * the Copilot Coding Agent AND names the `.github/agents/<name>.agent.md`
 * persona to load. Falls back to a plain `copilot-swe-agent[bot]` assignment +
 * an `@copilot use agent <name>` comment when the custom-agent extension isn't
 * available on the repo. Best-effort — never throws (a dispatch failure must
 * not abort issue processing).
 */
async function dispatchMaintenanceAgent(issueNumber) {
  const agent = config.maintenanceAgent;
  const baseBranch = await getDefaultBranch();
  try {
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/assignees', {
      owner: config.owner, repo: config.repo, issue_number: issueNumber,
      assignees: ['copilot-swe-agent[bot]'],
      agent_assignment: {
        target_repo: `${config.owner}/${config.repo}`,
        base_branch: baseBranch,
        custom_agent: agent,
        custom_instructions: '',
        model: '',
      },
      headers: { 'X-GitHub-Api-Version': '2022-11-28' },
    });
    log('SUCCESS', `Dispatched ${agent} to issue #${issueNumber}`);
    return true;
  } catch (error) {
    log('WARN', `Custom-agent dispatch failed for #${issueNumber} (${error.message}); falling back to @copilot mention`);
    try {
      await octokit.rest.issues.addAssignees({
        owner: config.owner, repo: config.repo, issue_number: issueNumber,
        assignees: ['copilot-swe-agent[bot]'],
      });
    } catch (assignErr) { log('WARN', `Fallback assignee add failed for #${issueNumber}: ${assignErr.message}`); }
    try {
      await octokit.rest.issues.createComment({
        owner: config.owner, repo: config.repo, issue_number: issueNumber,
        body: `@copilot use agent ${agent} — read \`.github/repo-metadata.yml\` and \`.cheshire/prompts/\`, then remediate this finding grounded in the real code.`,
      });
    } catch (commentErr) { log('WARN', `Fallback comment failed for #${issueNumber}: ${commentErr.message}`); }
    return false;
  }
}

async function createOrUpdateIssue(g, issueBody, labels) {
  const title = createIssueTitle(g);
  const existing = await findExistingIssue(g);

  if (existing) {
    await octokit.rest.issues.update({
      owner: config.owner, repo: config.repo, issue_number: existing.number, body: issueBody, labels
    });
    log('SUCCESS', `Updated issue #${existing.number}`);
    return { action: 'updated', issueNumber: existing.number };
  } else {
    const { data: issue } = await octokit.rest.issues.create({
      owner: config.owner, repo: config.repo, title, body: issueBody, labels,
      ...(config.autoAssign.length > 0 ? { assignees: config.autoAssign } : {})
    });
    log('SUCCESS', `Created issue #${issue.number}: ${title}`);
    // Auto-dispatch Alice ONLY when explicitly enabled (AUTO_ASSIGN_ALICE) and
    // ONLY on new findings (re-running CodeQL must not re-dispatch). By default
    // the issue is filed unassigned — the user triggers Alice from the
    // Security Scorecard's maintenance-issues list.
    if (config.autoAssignAlice) {
      await dispatchMaintenanceAgent(issue.number);
    } else {
      log('INFO', `Issue #${issue.number} filed unassigned (auto-assign disabled — assign Alice from the Scorecard)`);
    }
    return { action: 'created', issueNumber: issue.number };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log('INFO', `Processing ${config.sarifPath}`);

  const findings = parseSARIFResults(config.sarifPath);
  if (findings.length === 0) {
    log('INFO', 'No vulnerabilities found');
    fs.writeFileSync(summaryFile, JSON.stringify({ total: 0, created: 0, updated: 0 }, null, 2));
    return;
  }

  const grouped = groupFindingsByRuleAndFile(findings);
  log('INFO', `Grouped ${findings.length} finding(s) into ${grouped.length} issue(s)`);

  const results = { total: findings.length, created: 0, updated: 0, skipped: 0, errors: [] };
  let processed = 0;

  for (const g of grouped) {
    if (processed >= config.maxIssuesPerRun) { break; }
    if (!meetsSeverityThreshold(g.severity)) {
      log('INFO', `Skipped ${g.ruleId} (severity ${g.severity} below threshold ${config.severityThreshold})`);
      results.skipped++;
      continue;
    }

    const owaspInfo = mapToOWASP(g.ruleId);
    if (!owaspInfo) {
      log('WARN', `No OWASP mapping for rule ${g.ruleId} — creating issue with generic template`);
    }

    try {
      // OWASP category + key come from the LOCAL prompt-mappings.json (no
      // remote fetch / embed). The body references the .cheshire/prompts/ packs
      // by path; Alice reads them herself.
      const prompts = {
        owaspKey: owaspInfo?.key || 'unmapped',
        owaspCategory: owaspInfo?.name || `Security Finding (${g.ruleId})`,
      };

      const issueBody = createIssueBody(g, prompts);
      const labels = generateLabels(g, owaspInfo);
      const { action } = await createOrUpdateIssue(g, issueBody, labels);
      if (action === 'created') { results.created++; } else { results.updated++; }
      processed++;

      await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
    } catch (error) {
      log('ERROR', `Failed: ${g.ruleId} — ${error.message}`);
      results.errors.push({ ruleId: g.ruleId, error: error.message });
    }
  }

  fs.writeFileSync(summaryFile, JSON.stringify({ ...results, timestamp: new Date().toISOString() }, null, 2));
  log('SUCCESS', `Done: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped`);
}

main().catch(error => { console.error('Fatal:', error); process.exit(1); });
