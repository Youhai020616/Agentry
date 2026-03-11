#!/usr/bin/env node
/**
 * setup-test-agent.mjs
 *
 * Manually simulates what EmployeeManager.activate() does for the "researcher" employee:
 *   1. Reads SKILL.md from resources/employees/researcher/
 *   2. Replaces template variables ({{ROLE}}, {{ROLE_ZH}}, etc.)
 *   3. Creates workspace at ~/.agentry/employees/researcher/
 *   4. Writes AGENTS.md + CLAUDE.md with compiled system prompt
 *   5. Registers the agent in ~/.openclaw/openclaw.json agents.list
 *
 * Usage:
 *   node scripts/setup-test-agent.mjs                    # Setup researcher
 *   node scripts/setup-test-agent.mjs --employee browser-agent  # Setup specific employee
 *   node scripts/setup-test-agent.mjs --cleanup           # Remove test agent from config + workspace
 *   node scripts/setup-test-agent.mjs --all               # Setup all built-in employees
 *
 * After running, wait ~3s for Gateway hot-reload, then:
 *   node scripts/verify-phase1.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Paths ────────────────────────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, '..');
const BUILTIN_EMPLOYEES_DIR = join(PROJECT_ROOT, 'resources', 'employees');
const HOME = homedir();
const AGENTRY_EMPLOYEES_DIR = join(HOME, '.agentry', 'employees');
const OPENCLAW_CONFIG_PATH = join(HOME, '.openclaw', 'openclaw.json');

// ── ANSI ─────────────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function ok(msg) {
  console.log(`  ${C.green}✓${C.reset} ${msg}`);
}
function fail(msg) {
  console.log(`  ${C.red}✗${C.reset} ${msg}`);
}
function info(msg) {
  console.log(`  ${C.dim}ℹ ${msg}${C.reset}`);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function readConfig() {
  if (!existsSync(OPENCLAW_CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(OPENCLAW_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function listBuiltinEmployees() {
  if (!existsSync(BUILTIN_EMPLOYEES_DIR)) return [];
  return readdirSync(BUILTIN_EMPLOYEES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// ── Setup one employee ───────────────────────────────────────────────────

function setupEmployee(slug) {
  const skillDir = join(BUILTIN_EMPLOYEES_DIR, slug);

  if (!existsSync(skillDir)) {
    fail(`Skill directory not found: ${skillDir}`);
    return false;
  }

  // 1. Read manifest
  const manifestPath = join(skillDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail(`manifest.json not found in ${skillDir}`);
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const emp = manifest.employee;
  info(`${emp.avatar} ${emp.role} (${emp.roleZh}) — team: ${emp.team}`);

  // 2. Read and compile SKILL.md
  let systemPrompt;
  const skillMdPath = join(skillDir, 'SKILL.md');
  if (existsSync(skillMdPath)) {
    systemPrompt = readFileSync(skillMdPath, 'utf-8');
    // Replace template variables (same as compiler.ts replaceVariables)
    const normalizedSkillDir = skillDir.split(sep).join('/');
    systemPrompt = systemPrompt
      .replace(/\{\{ROLE\}\}/g, emp.role)
      .replace(/\{\{ROLE_ZH\}\}/g, emp.roleZh)
      .replace(/\{\{TEAM\}\}/g, emp.team)
      .replace(/\{\{PERSONALITY_STYLE\}\}/g, emp.personality.style)
      .replace(/\{\{SKILL_DIR\}\}/g, normalizedSkillDir);
    // Leave {{TEAM_ROSTER}} as-is (only supervisor uses it, would need EmployeeManager)
    ok(`SKILL.md loaded and compiled (${systemPrompt.length} chars)`);
  } else {
    systemPrompt = [
      `You are ${emp.role} (${emp.roleZh}), a member of the ${emp.team} team.`,
      '',
      `## About`,
      manifest.description,
      '',
      `## Personality`,
      `Your working style is: ${emp.personality.style}`,
      '',
      `## Instructions`,
      `Respond professionally according to your role and expertise.`,
    ].join('\n');
    ok(`Generated prompt from manifest (${systemPrompt.length} chars)`);
  }

  // 3. Create workspace
  const wsDir = join(AGENTRY_EMPLOYEES_DIR, slug);
  mkdirSync(wsDir, { recursive: true });
  writeFileSync(join(wsDir, 'AGENTS.md'), systemPrompt, 'utf-8');
  writeFileSync(join(wsDir, 'CLAUDE.md'), systemPrompt, 'utf-8');
  ok(`Workspace: ${wsDir}`);
  ok(`AGENTS.md written (${systemPrompt.length} chars)`);

  // 4. Register in openclaw.json
  const config = readConfig();
  if (!config.agents) config.agents = {};
  if (!Array.isArray(config.agents.list)) config.agents.list = [];

  // Remove existing entry
  config.agents.list = config.agents.list.filter((a) => a.id !== slug);

  // Build entry
  const agentEntry = {
    id: slug,
    name: `${emp.avatar} ${emp.roleZh}`,
    workspace: wsDir.split(sep).join('/'),
  };

  // Map built-in tools
  if (manifest.tools && manifest.tools.length > 0) {
    const BUILTIN = new Set(['web_search', 'web_fetch', 'read', 'write', 'exec', 'browser', 'mcp']);
    const allow = manifest.tools.filter((t) => BUILTIN.has(t.name)).map((t) => t.name);
    if (allow.length > 0) {
      agentEntry.tools = { allow };
      ok(`Tool policy: allow=[${allow.join(', ')}]`);
    }
  }

  config.agents.list.push(agentEntry);
  writeConfig(config);
  ok(`Registered in openclaw.json (agents.list now has ${config.agents.list.length} entry(ies))`);

  info(`Session key: agent:${slug}:main`);
  return true;
}

// ── Cleanup ──────────────────────────────────────────────────────────────

function cleanupAll() {
  console.log(`\n${C.bold}${C.cyan}Cleaning up all test agents...${C.reset}`);

  // Remove all workspaces
  if (existsSync(AGENTRY_EMPLOYEES_DIR)) {
    const entries = readdirSync(AGENTRY_EMPLOYEES_DIR, { withFileTypes: true }).filter((e) =>
      e.isDirectory()
    );
    for (const e of entries) {
      const wsDir = join(AGENTRY_EMPLOYEES_DIR, e.name);
      try {
        rmSync(wsDir, { recursive: true, force: true });
        ok(`Removed workspace: ${e.name}`);
      } catch (err) {
        fail(`Failed to remove ${e.name}: ${err.message}`);
      }
    }
  }

  // Remove agents.list from config
  const config = readConfig();
  if (config.agents && Array.isArray(config.agents.list)) {
    const count = config.agents.list.length;
    delete config.agents.list;
    writeConfig(config);
    ok(`Removed ${count} agent(s) from openclaw.json`);
  } else {
    info('No agents.list to clean up');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const doCleanup = args.includes('--cleanup');
const doAll = args.includes('--all');
const empIdx = args.indexOf('--employee');
const targetSlug = empIdx !== -1 ? args[empIdx + 1] : null;

console.log(`${C.bold}${C.cyan}`);
console.log(`╔══════════════════════════════════════════════════╗`);
console.log(`║   Setup Test Agent (simulate activate())        ║`);
console.log(`╚══════════════════════════════════════════════════╝${C.reset}`);

if (doCleanup) {
  cleanupAll();
  console.log(`\n${C.green}${C.bold}Done.${C.reset} Gateway will hot-reload in ~3s.`);
  process.exit(0);
}

const available = listBuiltinEmployees();
if (available.length === 0) {
  fail(`No built-in employees found at ${BUILTIN_EMPLOYEES_DIR}`);
  process.exit(1);
}

info(`Available employees: ${available.join(', ')}`);

const slugsToSetup = doAll ? available : [targetSlug || 'researcher'];

let successCount = 0;

for (const slug of slugsToSetup) {
  console.log(`\n${C.bold}── Setting up: ${slug} ──${C.reset}`);
  if (setupEmployee(slug)) {
    successCount++;
  }
}

console.log(
  `\n${C.bold}${successCount === slugsToSetup.length ? C.green : C.yellow}${successCount}/${slugsToSetup.length} employee(s) set up.${C.reset}`
);
console.log(`${C.dim}Wait ~3s for Gateway hot-reload, then run:${C.reset}`);
console.log(`  node scripts/verify-phase1.mjs`);
console.log(`  node scripts/verify-phase1.mjs --employee ${slugsToSetup[0]}`);
