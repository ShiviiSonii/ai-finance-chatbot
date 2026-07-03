import { v } from "convex/values";

export type Operator = "eq" | "gt" | "lt" | "gte" | "lte" | "neq";
export type AggregateType = "sum" | "count";
export type SortDirection = "asc" | "desc";
export type FieldValue = string | number | boolean | null;

export type QuerySpec = {
  table: string;
  filters: Array<{ field: string; op: Operator; value: FieldValue }>;
  groupBy: string | null;
  aggregate: { type: AggregateType; field: string } | null;
  sort: { field: string; direction: SortDirection } | null;
  limit: number | null;
};

const fieldValueValidator = v.union(v.string(), v.number(), v.boolean(), v.null());

const filterValidator = v.object({
  field: v.string(),
  op: v.union(
    v.literal("eq"),
    v.literal("gt"),
    v.literal("lt"),
    v.literal("gte"),
    v.literal("lte"),
    v.literal("neq"),
  ),
  value: fieldValueValidator,
});

const aggregateValidator = v.union(
  v.object({
    type: v.union(v.literal("sum"), v.literal("count")),
    field: v.string(),
  }),
  v.null(),
);

const sortValidator = v.union(
  v.object({
    field: v.string(),
    direction: v.union(v.literal("asc"), v.literal("desc")),
  }),
  v.null(),
);

export const structuredQuerySpecValidator = v.object({
  table: v.string(),
  filters: v.optional(v.array(filterValidator)),
  groupBy: v.optional(v.union(v.string(), v.null())),
  aggregate: v.optional(aggregateValidator),
  sort: v.optional(sortValidator),
  limit: v.optional(v.union(v.number(), v.null())),
});

type PartialQuerySpec = {
  table: string;
  filters?: QuerySpec["filters"];
  groupBy?: string | null;
  aggregate?: QuerySpec["aggregate"];
  sort?: QuerySpec["sort"];
  limit?: number | null;
};

export function normalizeQuerySpec(spec: PartialQuerySpec): QuerySpec {
  return {
    table: spec.table,
    filters: spec.filters ?? [],
    groupBy: spec.groupBy ?? null,
    aggregate: spec.aggregate ?? null,
    sort: spec.sort ?? null,
    limit: spec.limit ?? null,
  };
}

export function parseQuerySpecText(text: string): QuerySpec {
  const parsed = JSON.parse(text.trim()) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Top-level value must be a JSON object.");
  }

  const raw = parsed as Record<string, unknown>;
  if (typeof raw.table !== "string" || !raw.table) {
    throw new Error('Query spec must include a non-empty "table" field.');
  }

  return normalizeQuerySpec({
    table: raw.table,
    filters: Array.isArray(raw.filters) ? (raw.filters as QuerySpec["filters"]) : [],
    groupBy: raw.groupBy as string | null | undefined,
    aggregate: raw.aggregate as QuerySpec["aggregate"] | undefined,
    sort: raw.sort as QuerySpec["sort"] | undefined,
    limit: raw.limit as number | null | undefined,
  });
}
