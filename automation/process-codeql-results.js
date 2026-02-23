#!/usr/bin/env node

/**
 * CodeQL SARIF Results Processor
 *
 * Processes CodeQL SARIF results and creates GitHub issues with
 * embedded MaintainabilityAI prompts for security vulnerabilities.
 */

const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================================
// CONFIGURATION
// ============================================================================

const config = {
  githubToken: process.env.GITHUB_TOKEN,
  promptRepo: process.env.PROMPT_REPO || 'AliceNN-ucdenver/MaintainabilityAI',
  promptBranch: process.env.PROMPT_BRANCH || 'main',
  severityThreshold: process.env.SEVERITY_THRESHOLD || 'high',
  maxIssuesPerRun: parseInt(process.env.MAX_ISSUES_PER_RUN || '10', 10),
  enableMaintainability: process.env.ENABLE_MAINTAINABILITY === 'true',
  enableThreatModel: process.env.ENABLE_THREAT_MODEL === 'true',
  autoAssign: (process.env.AUTO_ASSIGN || '').split(',').filter(Boolean),
  excludedPaths: (process.env.EXCLUDED_PATHS || '').split(',').filter(Boolean),
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
// PROMPT CACHE & INTEGRITY
// ============================================================================

const promptCache = new Map();
const promptHashesPath = path.join(__dirname, 'prompt-hashes.json');
let promptHashes = {};
try {
  promptHashes = JSON.parse(fs.readFileSync(promptHashesPath, 'utf8'));
  log('SUCCESS', 'Loaded prompt hash manifest');
} catch (error) {
  log('ERROR', 'Failed to load prompt-hashes.json — cannot verify integrity');
  process.exit(1);
}

const ALLOWED_DOMAINS = ['raw.githubusercontent.com'];

function verifyPromptUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:') { return false; }
    return ALLOWED_DOMAINS.includes(url.hostname);
  } catch { return false; }
}

function verifyPromptIntegrity(content, expectedHash) {
  const actualHash = `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
  return actualHash === expectedHash;
}

async function fetchPrompt(category, file) {
  const cacheKey = `${category}/${file}`;
  if (promptCache.has(cacheKey)) { return promptCache.get(cacheKey); }

  const expectedHash = promptHashes[category]?.[file];
  if (!expectedHash) { return null; }

  const url = `https://raw.githubusercontent.com/${config.promptRepo}/${config.promptBranch}/examples/promptpack/${category}/${file}`;
  if (!verifyPromptUrl(url)) { return null; }

  try {
    const response = await axios.get(url, { timeout: 10000, validateStatus: (s) => s === 200 });
    const content = response.data;
    if (!verifyPromptIntegrity(content, expectedHash)) {
      log('ERROR', `Prompt integrity verification FAILED: ${cacheKey}`);
      return null;
    }
    promptCache.set(cacheKey, content);
    return content;
  } catch (error) {
    promptCache.set(cacheKey, null);
    return null;
  }
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
    for (const result of run.results || []) {
      const location = result.locations?.[0]?.physicalLocation;
      if (!location) { continue; }
      const rule = run.tool?.driver?.rules?.find(r => r.id === result.ruleId);
      // Prefer the numeric security-severity score (matches GitHub UI)
      // over result.level (warning/error/note) which is too coarse
      const secScore = parseFloat(rule?.properties?.['security-severity'] || '');
      const severity = !isNaN(secScore)
        ? numericToSeverity(secScore)
        : (mappings.severity_mapping[result.level] || 'medium');
      vulnerabilities.push({
        ruleId: result.ruleId,
        ruleName: rule?.shortDescription?.text || result.ruleId,
        ruleHelp: rule?.help?.text || '',
        message: result.message?.text || '',
        level: result.level || 'warning',
        severity,
        filePath: location.artifactLocation?.uri || 'unknown',
        startLine: location.region?.startLine || 1,
        endLine: location.region?.endLine || location.region?.startLine || 1,
        codeSnippet: location.region?.snippet?.text || '',
        tool, toolVersion
      });
    }
  }
  log('SUCCESS', `Parsed ${vulnerabilities.length} vulnerabilities from SARIF`);
  for (const v of vulnerabilities) {
    log('INFO', `  Rule: ${v.ruleId} | Level: ${v.level} | Severity: ${v.severity} | File: ${v.filePath}`);
  }
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

  // OWASP prompts
  if (prompts.owaspPrompts?.length > 0) {
    body += `<details>\n<summary>OWASP Security Guidance (${prompts.owaspPrompts.length} guide${prompts.owaspPrompts.length > 1 ? 's' : ''})</summary>\n\n`;
    for (const p of prompts.owaspPrompts) {
      body += `<details>\n<summary>${p.filename}</summary>\n\n${p.content}\n\n</details>\n\n`;
    }
    body += `</details>\n\n`;
  }

  // Maintainability prompts
  if (prompts.maintainabilityPrompts?.length > 0) {
    body += `<details>\n<summary>Maintainability Guidance (${prompts.maintainabilityPrompts.length} guide${prompts.maintainabilityPrompts.length > 1 ? 's' : ''})</summary>\n\n`;
    for (const p of prompts.maintainabilityPrompts) {
      body += `<details>\n<summary>${p.filename}</summary>\n\n${p.content}\n\n</details>\n\n`;
    }
    body += `</details>\n\n`;
  }

  // Remediation zone
  body += `---\n\n## Claude Remediation Zone\n\n`;
  body += `To request a remediation plan, post this comment:\n\n`;
  body += `\`\`\`\n@claude Please provide a remediation plan for all ${count} occurrence${count > 1 ? 's' : ''} of this vulnerability in ${g.filePath} following the security guidelines provided.\n\`\`\`\n\n---\n\n`;

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

async function createOrUpdateIssue(g, issueBody, labels) {
  const title = createIssueTitle(g);
  const existing = await findExistingIssue(g);

  if (existing) {
    await octokit.rest.issues.update({
      owner: config.owner, repo: config.repo, issue_number: existing.number, body: issueBody, labels
    });
    log('SUCCESS', `Updated issue #${existing.number}`);
    return { action: 'updated' };
  } else {
    const { data: issue } = await octokit.rest.issues.create({
      owner: config.owner, repo: config.repo, title, body: issueBody, labels,
      ...(config.autoAssign.length > 0 ? { assignees: config.autoAssign } : {})
    });
    log('SUCCESS', `Created issue #${issue.number}: ${title}`);
    return { action: 'created' };
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
      const prompts = {
        owaspKey: owaspInfo?.key || 'unmapped',
        owaspCategory: owaspInfo?.name || `Security Finding (${g.ruleId})`,
        owaspPrompts: [],
        maintainabilityPrompts: []
      };
      if (owaspInfo) {
        const owaspContent = await fetchPrompt('owasp', owaspInfo.prompt_file);
        if (owaspContent) { prompts.owaspPrompts.push({ filename: owaspInfo.prompt_file, content: owaspContent }); }
      }

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
