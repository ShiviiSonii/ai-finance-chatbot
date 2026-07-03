"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import { generateWithFallback, isRateLimitError } from "./groq";
import { parseQuerySpecText, type QuerySpec } from "./querySpec";

const MAX_COLUMNS = 6;
const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CHARS = 600;

const OFF_TOPIC_RESPONSE =
  "I'm a finance data assistant and can only answer questions about purchase orders, invoices, and payments in your dataset. Try asking about customers, amounts, overdue invoices, or payment history.";
const GREETING_RESPONSE =
  "Hi! I can help with your finance data. Ask me about purchase orders, invoices, payments, overdue invoices, or top customers.";

const historyMessageValidator = v.object({
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
});

type ToolRun = {
  name: string;
  args: QuerySpec;
  data: unknown;
};

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function trimHistory(
  history: Array<{ role: "user" | "assistant"; content: string }>,
) {
  return history.slice(-MAX_HISTORY_MESSAGES);
}

function truncateForContext(content: string): string {
  const withoutTables = content
    .replace(/\|[^\n]+\|\n\|[-:| ]+\|\n(?:\|[^\n]+\|\n?)+/g, "[table omitted]")
    .trim();
  if (withoutTables.length <= MAX_HISTORY_CHARS) return withoutTables;
  return `${withoutTables.slice(0, MAX_HISTORY_CHARS)}...`;
}

function formatConversationContext(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
): string {
  if (history.length === 0) {
    return `User question: ${message}`;
  }

  const transcript = history
    .map((entry) => {
      const speaker = entry.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${truncateForContext(entry.content)}`;
    })
    .join("\n\n");

  return `Conversation so far:\n${transcript}\n\nLatest user question: ${message}`;
}

function isGreetingOnlyMessage(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;

  const greetingTokens = new Set([
    "hi",
    "hii",
    "hiii",
    "hello",
    "hey",
    "heyy",
    "yo",
    "sup",
    "hola",
    "namaste",
  ]);

  const politeTokens = new Set([
    "dear",
    "buddy",
    "sir",
    "madam",
    "team",
    "there",
    "bot",
    "assistant",
    "please",
  ]);

  const tokens = normalized.split(" ");
  const greetingCount = tokens.filter((token) => greetingTokens.has(token)).length;
  if (greetingCount === 0) return false;

  // Treat short greeting phrases like "hello dear" as greetings.
  if (tokens.length <= 4 && tokens.every((token) => greetingTokens.has(token) || politeTokens.has(token))) {
    return true;
  }

  return tokens.every((token) => greetingTokens.has(token));
}

function isClearlyFinanceQuestion(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;

  const financeTerms = [
    "purchase order",
    "purchase orders",
    "po",
    "invoice",
    "invoices",
    "payment",
    "payments",
    "customer",
    "customers",
    "overdue",
    "unpaid",
    "paid",
    "amount",
    "currency",
    "due date",
    "late payment",
  ];

  return financeTerms.some((term) => normalized.includes(term));
}

function buildPlanningPrompt(
  conversationContext: string,
  schema: unknown,
  previousParseError?: string,
): string {
  const retryInstruction = previousParseError
    ? `\nYour previous response could not be parsed as JSON. Parse error: ${previousParseError}\nReturn corrected JSON only.`
    : "";

  return `You are a finance data query planner. Convert the user's question into exactly one JSON query spec.

Current date: ${todayIso()}. Use this date for questions about overdue invoices.

Schema description:
${JSON.stringify(schema, null, 2)}

JSON query spec format:
{
  "table": "<one of the existing table names>",
  "filters": [{ "field": string, "op": "eq"|"gt"|"lt"|"gte"|"lte"|"neq", "value": any }],
  "groupBy": string | null,
  "aggregate": { "type": "sum"|"count", "field": string } | null,
  "sort": { "field": string, "direction": "asc"|"desc" } | null,
  "limit": number | null
}

Rules:
- Respond with ONLY valid JSON. Do not include prose or markdown fences.
- Always include every top-level key from the format above. Use null for unused groupBy, aggregate, sort, and limit.
- Use only tables and fields from the schema description.
- For "top" or "highest" questions, use an aggregate, sort descending by the aggregate field name, and limit 1.
- Aggregate result field names are "<type>_<field>", for example "sum_amount" or "count_poId".
- For overdue invoices, filter invoices where status equals "Unpaid" and dueDate is less than today's date.
- For delayed or late payments, query payments where isLate equals true; group by customerName and count paymentId when the user asks which customers are frequent.
- For "total invoiced" questions, use the invoices table and sum amount.

${conversationContext}${retryInstruction}`;
}

function buildTopicClassificationPrompt(conversationContext: string): string {
  return `You classify whether a user message can be answered using finance business data.

Available data: purchase orders, invoices, and payments (customer names, amounts, currencies, dates, payment status, overdue and late payment flags).

${conversationContext}

Reply with ONLY valid JSON:
{ "onTopic": true }  — if the message asks about this finance data, or is a follow-up to a prior finance answer in the conversation
{ "onTopic": false } — if the message is unrelated (weather, jokes, general knowledge, coding help, chit-chat, etc.)

Rules:
- Short follow-ups after finance questions (for example "and the second one?" or "what about Acme?") are on-topic.
- Greetings alone (for example "hi" or "hello") are off-topic.
- Respond with ONLY the JSON object. Do not include prose or markdown fences.`;
}

function parseTopicClassification(text: string): boolean {
  const parsed = JSON.parse(text.trim()) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Top-level value must be a JSON object.");
  }

  const raw = parsed as Record<string, unknown>;
  if (typeof raw.onTopic !== "boolean") {
    throw new Error('Classification must include a boolean "onTopic" field.');
  }

  return raw.onTopic;
}

async function isMessageOnTopic(conversationContext: string): Promise<boolean> {
  try {
    const { response } = await generateWithFallback(
      {
        messages: [
          {
            role: "user",
            content: buildTopicClassificationPrompt(conversationContext),
          },
        ],
      },
      "topic classification",
    );

    return parseTopicClassification(response.text ?? "");
  } catch (error) {
    if (isRateLimitError(error)) {
      throw error;
    }
    return true;
  }
}

async function planStructuredQuery(
  ctx: ActionCtx,
  conversationContext: string,
): Promise<QuerySpec> {
  const schema = await ctx.runQuery(internal.financeData.describeQueryableSchema, {});
  let parseError: string | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { response } = await generateWithFallback(
      {
        messages: [
          {
            role: "user",
            content: buildPlanningPrompt(conversationContext, schema, parseError),
          },
        ],
      },
      "query spec generation",
    );

    try {
      return parseQuerySpecText(response.text ?? "");
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
      if (attempt === 0) {
        console.log(
          `[LLM RETRY] ${new Date().toISOString()} step="query spec generation" attempt=2/2 retryInMs=0 previousError="${parseError}"`,
        );
      }
    }
  }

  throw new Error(`LLM returned invalid JSON: ${parseError ?? "unknown parse error"}`);
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.replaceAll("|", "\\|");
  return JSON.stringify(value).replaceAll("|", "\\|");
}

function pickColumns(rows: Record<string, unknown>[]): string[] {
  const hiddenColumns = new Set([
    "rowCount",
    "matchedRowCount",
    "spec",
  ]);
  const preferredOrder = [
    "id",
    "poId",
    "invoiceId",
    "paymentId",
    "customerName",
    "customerId",
    "amount",
    "sum_amount",
    "count_paymentId",
    "count_poId",
    "currency",
    "status",
    "orderDate",
    "dueDate",
    "paymentDate",
    "paymentDelayDays",
    "isLate",
  ];
  const present = new Set(
    rows
      .flatMap((row) => Object.keys(row))
      .filter((col) => !hiddenColumns.has(col)),
  );
  const preferred = preferredOrder.filter((col) => present.has(col));
  const remainder = [...present].filter((col) => !preferred.includes(col)).sort();
  return [...preferred, ...remainder].slice(0, MAX_COLUMNS);
}

function renderTable(rows: Record<string, unknown>[]): string {
  if (rows.length < 2) return "";
  const columns = pickColumns(rows);
  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${columns.map((col) => formatScalar(row[col])).join(" | ")} |`)
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}

function asRecordArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (!value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item))) {
    return null;
  }
  return value as Record<string, unknown>[];
}

function toolRunKey(name: string, args: QuerySpec): string {
  return `${name}:${JSON.stringify(args)}`;
}

function extractTableRows(data: unknown): Record<string, unknown>[] | null {
  const directRows = asRecordArray(data);
  if (directRows) return directRows;

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if ("rows" in record) {
      return asRecordArray(record.rows);
    }
  }

  return null;
}

function renderTablesInCode(toolRuns: ToolRun[]): string {
  const sections: string[] = [];
  const seen = new Set<string>();
  for (const run of toolRuns) {
    const key = toolRunKey(run.name, run.args);
    if (seen.has(key)) continue;
    seen.add(key);

    const rows = extractTableRows(run.data);
    if (!rows) continue;

    const table = renderTable(rows);
    if (table) sections.push(table);
  }
  return sections.join("\n\n");
}

function countRecords(data: unknown): number | null {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const values = Object.values(data as Record<string, unknown>);
    const arrayValues = values.filter((value) => Array.isArray(value));
    if (arrayValues.length > 0) {
      return arrayValues.reduce<number>(
        (sum, value) => sum + (value as unknown[]).length,
        0,
      );
    }
  }
  return null;
}

function buildLocalSummary(toolRuns: ToolRun[]): string {
  if (toolRuns.length === 0) {
    return "I couldn't retrieve matching finance data.";
  }

  const parts = toolRuns.map((run) => {
    const label = run.name.replaceAll("_", " ");
    const count = countRecords(run.data);
    if (count === 0) return `No records found for ${label}.`;
    if (count !== null) return `Found ${count} record(s) for ${label}.`;
    return `Retrieved ${label} data.`;
  });

  return parts.join(" ");
}

function isStructuredQueryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid JSON|Unknown table|Unknown field|limit must|ArgumentValidationError/i.test(
    message,
  );
}

export const ask = action({
  args: {
    message: v.string(),
    history: v.optional(v.array(historyMessageValidator)),
  },
  handler: async (ctx, args) => {
    const history = trimHistory(args.history ?? []);
    if (isGreetingOnlyMessage(args.message)) {
      return GREETING_RESPONSE;
    }

    const conversationContext = formatConversationContext(history, args.message);
    const skipTopicCheck = isClearlyFinanceQuestion(args.message);
    const toolRuns: ToolRun[] = [];
    let assistantText = "";

    try {
      const onTopic = skipTopicCheck ? true : await isMessageOnTopic(conversationContext);
      if (!onTopic) {
        return OFF_TOPIC_RESPONSE;
      }

      const spec = await planStructuredQuery(ctx, conversationContext);

      const data = await ctx.runQuery(internal.financeData.runStructuredQuery, {
        spec,
      });

      toolRuns.push({
        name: "structured_query",
        args: spec,
        data,
      });

      try {
        const { response: summary } = await generateWithFallback(
          {
            messages: [
              {
                role: "user",
                  content: `You are a finance assistant. Answer in 1-2 sentences using ONLY the query result. Tables are rendered automatically, so summarize rather than listing every row.
Never infer or assume currency from symbols (for example "$"). Only mention currency when a currency field is explicitly present in the returned data.

${conversationContext}

Structured query result:
${JSON.stringify(toolRuns, null, 2)}

${
  countRecords(data) === 0
    ? "The query returned zero rows. State that clearly and do not guess missing data."
    : "Use the returned rows and aggregate values directly."
}`,
              },
            ],
          },
          "answer phrasing",
        );
        assistantText = summary.text?.trim() ?? "";
      } catch (error) {
        assistantText = isRateLimitError(error)
          ? `${buildLocalSummary(toolRuns)}\n\nAI service is temporarily rate-limited, please try again in a moment.`
          : buildLocalSummary(toolRuns);
      }
    } catch (error) {
      if (toolRuns.length > 0) {
        const tables = renderTablesInCode(toolRuns);
        const summary = buildLocalSummary(toolRuns);
        return tables ? `${summary}\n\n${tables}` : summary;
      }
      if (isStructuredQueryError(error)) {
        const message = error instanceof Error ? error.message : String(error);
        return `I couldn't run that as a valid structured query: ${message}`;
      }
      if (isRateLimitError(error)) {
        return "AI service is temporarily rate-limited, please try again in a moment.";
      }
      return "AI service is temporarily unavailable. Wait a minute and try again.";
    }

    const tables = renderTablesInCode(toolRuns);
    if (!tables) return assistantText;
    return `${assistantText}\n\n${tables}`;
  },
});
