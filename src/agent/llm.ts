import OpenAI from "openai";
import { getEnv } from "@/lib/env";

export function isLlmConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.LLM_API_KEY && env.LLM_MODEL);
}

export function createLlmClient(): OpenAI {
  const env = getEnv();
  return new OpenAI({
    baseURL: env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY || "unconfigured",
  });
}
