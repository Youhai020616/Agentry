#!/usr/bin/env node
/**
 * create-skill-package -- Scaffold a new Agentry skill package
 * Usage: npx tsx scripts/create-skill-package.ts <name>
 */
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const name = process.argv[2];
if (!name) {
  console.error('Usage: create-skill-package <name>');
  console.error('Example: create-skill-package my-analyst');
  process.exit(1);
}

const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
const targetDir = join(process.cwd(), 'resources', 'employees', slug);

if (existsSync(targetDir)) {
  console.error(`Error: Directory already exists: ${targetDir}`);
  process.exit(1);
}

// Create directory
mkdirSync(targetDir, { recursive: true });

// Generate manifest.json template (matches SkillManifest type from src/types/manifest.ts)
const manifest = {
  name: slug,
  version: '1.0.0',
  description: `AI Employee: ${name}`,
  type: 'knowledge',
  employee: {
    role: `${name} Specialist`,
    roleZh: `${name} 专家`,
    avatar: '🤖',
    team: 'general',
    personality: {
      style: 'professional and helpful',
      greeting: `Hi! I'm your ${name} assistant. How can I help?`,
      greetingZh: `你好！我是你的${name}助手，有什么可以帮你的？`,
    },
  },
  skills: [
    {
      id: 'default',
      name: 'Default Skill',
      prompt: './SKILL.md',
    },
  ],
  capabilities: {
    inputs: ['text'],
    outputs: ['text'],
  },
  tools: [],
  pricing: {
    model: 'included',
  },
};

writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Generate SKILL.md template (matches existing employee pattern with template vars)
const skillMd = `# {{ROLE}} — {{TEAM}} Team

You are a ${name} specialist. Your working style is {{PERSONALITY_STYLE}}.

## Core Expertise

### 1. Primary Skill
Describe the primary capability of this AI employee.

**Key Areas:**
- Area 1
- Area 2
- Area 3

## Working Guidelines

- Provide specific, actionable recommendations
- Ask clarifying questions when the request is ambiguous
- Include examples when explaining concepts
- Consider the user's context and technical level
`;

writeFileSync(join(targetDir, 'SKILL.md'), skillMd);

console.log(`\u2705 Skill package created: ${targetDir}`);
console.log(`\nFiles:`);
console.log(`  ${targetDir}/manifest.json`);
console.log(`  ${targetDir}/SKILL.md`);
console.log(`\nNext steps:`);
console.log(`  1. Edit manifest.json to configure the employee`);
console.log(`  2. Edit SKILL.md to define the system prompt`);
console.log(`  3. Restart Agentry to load the new employee`);
