"use node";

/// <reference types="node" />

export type LlmMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type LlmRequest = {
  messages: LlmMessage[];
};

export type LlmResponse = {
  text?: string;
};

const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_ATTEMPTS = 2;
const INITIAL_BACKOFF_MS = 1000;
const DEFAULT_MIN_INTERVAL_MS = 0;

let nextLlmCallAt = 0;
let llmQueue: Promise<void> = Promise.resolve();
let outboundCallCount = 0;

export class LlmRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRateLimitError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timestamp(): string {
  return new Date().toISOString();
}

function getGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Run: npx convex env set GROQ_API_KEY your_key",
    );
  }
  return apiKey;
}

function getMinIntervalMs(): number {
  const configured = Number(process.env.LLM_MIN_INTERVAL_MS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_MIN_INTERVAL_MS;
}

async function waitForLlmSlot(step: string): Promise<void> {
  let releaseCurrent: () => void = () => {};
  const currentTurn = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const previousTurn = llmQueue;
  llmQueue = currentTurn;

  await previousTurn.catch(() => null);

  const waitMs = Math.max(0, nextLlmCallAt - Date.now());
  if (waitMs > 0) {
    console.log(
      `[LLM THROTTLE] ${timestamp()} waiting ${waitMs}ms before step="${step}"`,
    );
    await sleep(waitMs);
  }

  nextLlmCallAt = Date.now() + getMinIntervalMs();
  releaseCurrent();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRateLimitError(error: unknown): boolean {
  return /429|quota|rate limit|resource_exhausted|exhausted|too many requests|rpd|rpm/i.test(
    errorMessage(error),
  );
}

function isRetriableModelError(error: unknown): boolean {
  return /429|500|502|503|504|quota|rate limit|resource_exhausted|exhausted|too many requests|capacity|unavailable|high demand/i.test(
    errorMessage(error),
  );
}

async function callGroq(request: LlmRequest, model: string): Promise<LlmResponse> {
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getGroqApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      max_tokens: 1024,
      temperature: 0.2,
    }),
  });

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(`Groq ${response.status}: ${body.error?.message ?? response.statusText}`);
  }

  return {
    text: body.choices?.[0]?.message?.content ?? "",
  };
}

function logOutboundCall(model: string, step: string, attempt: number): void {
  outboundCallCount += 1;
  console.log(
    `[LLM CALL] ${timestamp()} count=${outboundCallCount} step="${step}" model=${model} attempt=${attempt}`,
  );
}

export async function generateWithFallback(
  request: LlmRequest,
  step = "unspecified",
): Promise<{ response: LlmResponse; model: string }> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      const backoffMs = INITIAL_BACKOFF_MS * 2 ** (attempt - 2);
      console.log(
        `[LLM RETRY] ${timestamp()} step="${step}" attempt=${attempt}/${MAX_ATTEMPTS} retryInMs=${backoffMs} previousError="${errorMessage(lastError)}"`,
      );
      await sleep(backoffMs);
    }

    await waitForLlmSlot(step);
    logOutboundCall(GROQ_MODEL, step, attempt);

    try {
      const response = await callGroq(request, GROQ_MODEL);
      return { response, model: GROQ_MODEL };
    } catch (error) {
      lastError = error;
      if (!isRetriableModelError(error) || attempt >= MAX_ATTEMPTS) {
        if (isRateLimitError(error)) {
          throw new LlmRateLimitError(errorMessage(error));
        }
        throw error;
      }
    }
  }

  if (isRateLimitError(lastError)) {
    throw new LlmRateLimitError(errorMessage(lastError));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Groq model ${GROQ_MODEL} failed.`);
}
