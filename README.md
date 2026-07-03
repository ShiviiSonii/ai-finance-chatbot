# AI Finance Chatbot

This app is a React + Convex finance chatbot. The UI and Groq provider setup power a generalized structured-query flow instead of fixed business lookup functions.

## Architecture

User questions are handled by `convex/chat.ts`:

1. The action sends the user's question, conversation context, schema description, and the JSON query spec format to Groq.
2. Groq must return only a JSON query spec:

```json
{
  "table": "<one of the existing table names>",
  "filters": [{ "field": "string", "op": "eq|gt|lt|gte|lte|neq", "value": "any" }],
  "groupBy": "string or null",
  "aggregate": { "type": "sum|count|avg|max|min", "field": "string" },
  "sort": { "field": "string", "direction": "asc|desc" },
  "limit": "number or null"
}
```

3. If Groq returns invalid JSON, the app retries once with the parse error included.
4. The parsed spec is passed to `convex/financeData.ts:runStructuredQuery`.
5. `runStructuredQuery` validates the table and fields against the queryable schema, then applies filters, grouping, aggregation, sorting, and limit.
6. The result and original question are sent back to Groq for the final natural-language answer. If the query returns zero rows, the final prompt explicitly says so.

## Queryable Data

The existing Convex schema is preserved:

- `purchaseOrders`: purchase order ID, customer, amount, currency, order date
- `invoices`: invoice ID, purchase order ID, amount, currency, due date, paid/unpaid status
- `payments`: payment ID, invoice ID, customer, amount, currency, payment date

The `payments` query path also exposes derived query fields from existing invoice data:

- `dueDate`
- `paymentDelayDays`
- `isLate`

These derived fields let generalized specs answer late-payment questions without restoring a hardcoded `getLatePayments` function.

## Why This Is More General

Previously, the LLM selected from fixed functions such as `getTopPayingCustomer` or `getLatePayments`. Any unsupported question required adding another bespoke function.

Now the LLM only has to express the user's intent as data: table, filters, grouping, aggregate, sorting, and limit. The same `runStructuredQuery` function can answer known questions and new combinations such as:

- "Who is my top paying customer?"
- "Which customers frequently delay payments?"
- "What's the total invoiced amount in EUR?"
- "List all overdue invoices"
- "How many POs did a customer place?"
- "What's the average payment delay?"

## Development

```bash
npm install
npm run dev
```

## LLM Provider And Rate Controls

The app uses [Groq](https://console.groq.com) (`llama-3.3-70b-versatile`) via Convex environment variables:

- `GROQ_API_KEY` — get a free key at [console.groq.com](https://console.groq.com/keys)
- `LLM_MIN_INTERVAL_MS` to space outbound LLM calls, defaulting to `0`

Each user question normally makes at most two LLM calls: one for query spec generation and one for answer phrasing. The LLM wrapper logs every outbound call with `[LLM CALL]`, spaces calls through a small in-process queue, and caps provider retry behavior to two total attempts with `[LLM RETRY]` logs and exponential backoff.

Build and lint:

```bash
npm run build
npm run lint
```
