// SPDX-License-Identifier: Apache-2.0

import type { MemoryItem } from '@shared/types'
import { MEMORY_LIMITS } from '@shared/types'

/**
 * Build the extraction prompt for the LLM.
 *
 * The prompt instructs the model to extract structured memories
 * from an interaction, classify scope (user vs project) based on
 * content semantics, and merge with existing memories when appropriate.
 */

export interface ExtractionPromptParams {
  content: string
  projectName: string | null
  sourceType: string
  existingMemories: {
    user: MemoryItem[]
    project: MemoryItem[]
  }
}

export function buildExtractionPrompt(params: ExtractionPromptParams): string {
  const userMemorySummary =
    params.existingMemories.user.length > 0
      ? params.existingMemories.user
          .map((m) => `- [${m.id}] (${m.category}) ${m.content}`)
          .join('\n')
      : '(none)'

  const projectMemorySummary =
    params.existingMemories.project.length > 0
      ? params.existingMemories.project
          .map((m) => `- [${m.id}] (${m.category}) ${m.content}`)
          .join('\n')
      : '(none)'

  return `## Role
You are a Memory Analyst for OpenCow, an AI-powered project management tool.
Extract valuable, reusable memories from user interactions.

## Context
- Source: ${params.sourceType}
${params.projectName ? `- Current project: ${params.projectName}` : '- No project context'}
- Existing user-level memories:
${userMemorySummary}
- Existing project-level memories:
${projectMemorySummary}

## Interaction Content
${params.content}

## Instructions
Analyze the interaction and extract memories that help OpenCow better serve this user in future interactions.

For each memory:
1. Be specific and actionable — "Prefers TypeScript strict mode" not "Likes TypeScript"
2. Separate facts from opinions — facts are verifiable; opinions are subjective
3. Assign accurate confidence:
   - 0.9-1.0: User explicitly stated (e.g., "I am a PM at XYZ")
   - 0.7-0.8: Strong behavioral pattern (e.g., always uses Chinese)
   - 0.5-0.6: Single-time inference (e.g., mentioned liking a tool once)
4. Skip if nothing valuable — return empty array rather than low-quality memories
5. **Merge with existing**: If an existing memory (in either scope) covers the SAME topic but with less detail:
   - Set action="update" and targetId to the existing memory's [id]
   - Put the MERGED content (combining old + new information) in "content"
   - The merged content should be richer and more complete than either alone
6. If an existing memory already fully covers this information, skip it entirely
7. Only use action="new" when the information is genuinely not covered by any existing memory

## Scope Classification
Each memory must be assigned a scope based on its CONTENT, not where the conversation happened:
- **"user"**: Personal traits that apply across ALL projects — identity, role, skills, aesthetic preferences, communication style, general workflow habits
  Examples: "10 years Go experience", "prefers minimalist design", "is a backend developer", "likes direct communication"
- **"project"**: Context specific to the current project — architecture decisions, tech stack choices, coding conventions, project goals, team agreements
  Examples: "project uses monorepo structure", "API uses REST not GraphQL", "deploy target is AWS EKS"

Rule of thumb: If the memory would still be true/useful in a DIFFERENT project, it's "user" scope.
If the content mentions specific project artifacts (table names, file paths, architecture decisions, tech stack choices), it's "project" scope even if no project context is provided.

## Output Format (JSON only, no markdown fences)
{
  "memories": [
    {
      "action": "new",
      "targetId": null,
      "content": "concise natural language description",
      "category": "preference|background|behavior|workflow|fact|opinion|domain_knowledge|decision|project_context|requirement|convention|lesson_learned",
      "scope": "user",
      "confidence": 0.5,
      "tags": ["tag1", "tag2"],
      "reasoning": "why this is worth remembering"
    }
  ],
  "skipReason": null
}

### action field rules
- "new": genuinely new information not covered by any existing memory
- "update": enriches/supersedes an existing memory → set targetId to the existing memory's ID

## Source Awareness
The interaction content contains messages from both the User and the Assistant.
- **ONLY extract memories from what the User explicitly said or clearly implied**
- **NEVER extract from the Assistant's responses** — the assistant may repeat system prompt instructions, describe its own behavior, or speculate about the user. These are NOT user preferences.
- If the assistant says "you prefer X" or "I notice you like Y", verify that the USER actually expressed this, not just the assistant inferring it
- System-level configurations, tool behaviors, and AI identity settings are NOT user memories

## Quality Rules
- DO NOT extract greetings, filler, or procedural chat
- DO NOT create a new memory when an existing one covers the same topic — use action="update" instead
- DO NOT extract session-specific temporary context (e.g., "currently editing file X")
- DO NOT extract negative knowledge (e.g., "has not defined X yet", "hasn't specified Y") — only extract what the user HAS expressed
- DO NOT extract the assistant's operational rules or system prompt content as user preferences
- DO extract user preferences, professional background, project decisions
- DO extract patterns across multiple interactions
- PREFER fewer high-quality memories over many low-quality ones
- PREFER action="update" over action="new" when an existing memory is related
- Maximum 3 memories per extraction
- Each memory content MUST be under ${MEMORY_LIMITS.maxContentLength} characters. If the information is too rich for one memory, split it into multiple atomic memories (e.g., separate "tech stack" from "coding conventions" from "architecture decisions")`
}
