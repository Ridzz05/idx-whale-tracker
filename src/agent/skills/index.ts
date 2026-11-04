import { z, type ZodObject, type ZodRawShape } from "zod";
import type OpenAI from "openai";
import { searchKnowledgeSkill } from "./search-knowledge";
import { getStockSkill } from "./get-stock";
import { getInvestorSkill } from "./get-investor";
import { topHoldersSkill } from "./top-holders";
import { sectorRotationSkill } from "./sector-rotation";
import { bandarSignalsSkill } from "./bandar-signals";
import { webSwarmSkill } from "./web-swarm";
import { fetchUrlSkill } from "./fetch-url";
import { marketMoversSkill } from "./market-movers";

export interface RegisteredSkill {
  name: string;
  description: string;
  schema: ZodObject<ZodRawShape>;
  parseAndRun: (rawArgs: unknown, ctx?: unknown) => Promise<unknown>;
}

function wrapSkill<S extends ZodRawShape>(skill: {
  name: string;
  description: string;
  schema: ZodObject<S>;
  run: (args: z.infer<ZodObject<S>>, ctx?: unknown) => Promise<unknown>;
}): RegisteredSkill {
  return {
    name: skill.name,
    description: skill.description,
    schema: skill.schema,
    async parseAndRun(rawArgs: unknown, ctx?: unknown) {
      const validated = skill.schema.parse(rawArgs);
      return skill.run(validated, ctx);
    },
  };
}

export const SKILLS: RegisteredSkill[] = [
  wrapSkill(searchKnowledgeSkill),
  wrapSkill(getStockSkill),
  wrapSkill(getInvestorSkill),
  wrapSkill(topHoldersSkill),
  wrapSkill(sectorRotationSkill),
  wrapSkill(bandarSignalsSkill),
  wrapSkill(webSwarmSkill),
  wrapSkill(fetchUrlSkill),
  wrapSkill(marketMoversSkill),
];

const skillMap = new Map<string, RegisteredSkill>(
  SKILLS.map((s) => [s.name, s])
);

export function getOpenAiTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return SKILLS.map((s) => {
    const jsonSchema = z.toJSONSchema(s.schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    return {
      type: "function" as const,
      function: {
        name: s.name,
        description: s.description,
        parameters: jsonSchema,
      },
    };
  });
}

export async function executeSkill(
  name: string,
  rawArgsJson: string,
  ctx?: unknown
): Promise<string> {
  const skill = skillMap.get(name);
  if (!skill) {
    return JSON.stringify({ error: `Skill tidak dikenal: ${name}` });
  }
  try {
    const parsedJson: unknown = rawArgsJson.trim() ? JSON.parse(rawArgsJson) : {};
    const output = await skill.parseAndRun(parsedJson, ctx);
    const serialized = JSON.stringify(output);
    return serialized.length > 8000 ? serialized.slice(0, 8000) : serialized;
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
