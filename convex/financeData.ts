import { internalQuery, type QueryCtx } from "./_generated/server";
import {
  normalizeQuerySpec,
  structuredQuerySpecValidator,
  type FieldValue,
  type QuerySpec,
} from "./querySpec";

const MAX_ROWS = 1000;

const schemaDescription = {
  purchaseOrders: {
    poId: "string",
    customerId: "string",
    customerName: "string",
    amount: "number",
    currency: "string",
    orderDate: "string",
    invoicedAmount: "number (derived from invoices by poId)",
    remainingToInvoice: "number (purchase order amount minus invoicedAmount)",
    invoiceCount: "number (derived from invoices by poId)",
    invoiceCoverageStatus: "'Fully Invoiced' | 'Partially Invoiced' | 'Not Invoiced' (derived from invoice totals by poId)",
  },
  invoices: {
    invoiceId: "string",
    poId: "string",
    customerId: "string (derived from purchaseOrders by poId)",
    customerName: "string (derived from purchaseOrders by poId)",
    amount: "number",
    currency: "string",
    dueDate: "string",
    status: "'Paid' | 'Unpaid'",
  },
  payments: {
    paymentId: "string",
    invoiceId: "string",
    customerId: "string",
    customerName: "string",
    amount: "number",
    currency: "string",
    paymentDate: "string",
    dueDate: "string (derived from invoices by invoiceId)",
    paymentDelayDays: "number (derived from paymentDate - invoice dueDate)",
    isLate: "boolean (derived from paymentDate > invoice dueDate)",
  },
} as const;

type TableName = keyof typeof schemaDescription;
type QueryRow = Record<string, FieldValue>;

function isTableName(table: string): table is TableName {
  return table in schemaDescription;
}

function tableFields(table: TableName): Set<string> {
  return new Set(["_id", "_creationTime", ...Object.keys(schemaDescription[table])]);
}

function validateField(table: TableName, field: string): void {
  if (!tableFields(table).has(field)) {
    throw new Error(`Unknown field "${field}" for table "${table}".`);
  }
}

function validateSpec(spec: QuerySpec): TableName {
  if (!isTableName(spec.table)) {
    throw new Error(`Unknown table "${spec.table}".`);
  }

  for (const filter of spec.filters) {
    validateField(spec.table, filter.field);
  }
  if (spec.groupBy !== null) validateField(spec.table, spec.groupBy);
  if (spec.aggregate !== null) validateField(spec.table, spec.aggregate.field);
  if (spec.sort !== null) {
    const aggregateSortField =
      spec.aggregate !== null ? aggregateAlias(spec.aggregate) : null;
    if (spec.sort.field !== aggregateSortField) {
      validateField(spec.table, spec.sort.field);
    }
  }
  if (spec.limit !== null && (!Number.isInteger(spec.limit) || spec.limit < 1)) {
    throw new Error("limit must be a positive integer or null.");
  }

  return spec.table;
}

function toQueryRow(row: Record<string, unknown>): QueryRow {
  const result: QueryRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
    }
  }
  return result;
}

function parseIsoDate(value: string): number {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isNaN(time) ? 0 : time;
}

function daysBetween(startDate: string, endDate: string): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.round((parseIsoDate(endDate) - parseIsoDate(startDate)) / dayMs);
}

function compareValues(
  left: FieldValue | undefined,
  op: QuerySpec["filters"][number]["op"],
  right: FieldValue,
): boolean {
  if (op === "eq") return left === right;
  if (op === "neq") return left !== right;
  if (left === null || left === undefined || right === null) return false;
  if (typeof left !== typeof right) return false;

  switch (op) {
    case "gt":
      return left > right;
    case "lt":
      return left < right;
    case "gte":
      return left >= right;
    case "lte":
      return left <= right;
  }
}

function applyFilters(rows: QueryRow[], filters: QuerySpec["filters"]): QueryRow[] {
  return rows.filter((row) =>
    filters.every((filter) => compareValues(row[filter.field], filter.op, filter.value)),
  );
}

function compareForSort(left: FieldValue | undefined, right: FieldValue | undefined): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  return left > right ? 1 : -1;
}

function applySort(rows: QueryRow[], sort: QuerySpec["sort"]): QueryRow[] {
  if (sort === null) return rows;
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort(
    (left, right) => compareForSort(left[sort.field], right[sort.field]) * direction,
  );
}

function numericValues(rows: QueryRow[], field: string): number[] {
  return rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function aggregateRows(rows: QueryRow[], aggregate: NonNullable<QuerySpec["aggregate"]>): number {
  if (aggregate.type === "count") return rows.length;

  const values = numericValues(rows, aggregate.field);
  if (values.length === 0) return 0;

  return values.reduce((sum, value) => sum + value, 0);
}

function aggregateAlias(aggregate: NonNullable<QuerySpec["aggregate"]>): string {
  return `${aggregate.type}_${aggregate.field}`;
}

function currencyFromRows(rows: QueryRow[]): string | null {
  const currencies = new Set(
    rows
      .map((row) => row.currency)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  );
  if (currencies.size === 0) return null;
  if (currencies.size === 1) return [...currencies][0]!;
  return "Mixed";
}

function invoiceCoverageStatus(
  poAmount: number,
  invoicedAmount: number,
): "Fully Invoiced" | "Partially Invoiced" | "Not Invoiced" {
  if (invoicedAmount >= poAmount) return "Fully Invoiced";
  if (invoicedAmount > 0) return "Partially Invoiced";
  return "Not Invoiced";
}

function applyAggregate(rows: QueryRow[], spec: QuerySpec): QueryRow[] {
  if (spec.aggregate === null) return rows;

  const alias = aggregateAlias(spec.aggregate);
  if (spec.groupBy === null) {
    return [
      {
        [alias]: aggregateRows(rows, spec.aggregate),
        rowCount: rows.length,
      },
    ];
  }

  const groups = new Map<string, { value: FieldValue; rows: QueryRow[] }>();
  for (const row of rows) {
    const value = row[spec.groupBy] ?? null;
    const key = JSON.stringify(value);
    const existing = groups.get(key) ?? { value, rows: [] };
    existing.rows.push(row);
    groups.set(key, existing);
  }

  return [...groups.values()].map((group) => {
    const result: QueryRow = {
      [spec.groupBy!]: group.value,
      [alias]: aggregateRows(group.rows, spec.aggregate!),
      rowCount: group.rows.length,
    };

    // Surface a deterministic currency for grouped totals when possible.
    if (spec.groupBy !== "currency") {
      const currency = currencyFromRows(group.rows);
      if (currency !== null) {
        result.currency = currency;
      }
    }

    return result;
  });
}

async function readRows(
  ctx: QueryCtx,
  table: TableName,
): Promise<QueryRow[]> {
  if (table === "purchaseOrders") {
    const purchaseOrders = await ctx.db.query("purchaseOrders").take(MAX_ROWS);
    const invoices = await ctx.db.query("invoices").take(MAX_ROWS);
    const invoiceSummariesByPoId = new Map<string, { amount: number; count: number }>();

    for (const invoice of invoices) {
      const existing = invoiceSummariesByPoId.get(invoice.poId) ?? { amount: 0, count: 0 };
      existing.amount += invoice.amount;
      existing.count += 1;
      invoiceSummariesByPoId.set(invoice.poId, existing);
    }

    return purchaseOrders.map((purchaseOrder) => {
      const invoiceSummary = invoiceSummariesByPoId.get(purchaseOrder.poId) ?? {
        amount: 0,
        count: 0,
      };
      const remainingToInvoice = Math.max(0, purchaseOrder.amount - invoiceSummary.amount);

      return toQueryRow({
        ...purchaseOrder,
        invoicedAmount: invoiceSummary.amount,
        remainingToInvoice,
        invoiceCount: invoiceSummary.count,
        invoiceCoverageStatus: invoiceCoverageStatus(purchaseOrder.amount, invoiceSummary.amount),
      });
    });
  }

  if (table === "invoices") {
    const invoices = await ctx.db.query("invoices").take(MAX_ROWS);
    const purchaseOrders = await ctx.db.query("purchaseOrders").take(MAX_ROWS);
    const purchaseOrdersById = new Map(purchaseOrders.map((po) => [po.poId, po]));

    return invoices.map((invoice) => {
      const purchaseOrder = purchaseOrdersById.get(invoice.poId);
      return toQueryRow({
        ...invoice,
        customerId: purchaseOrder?.customerId ?? null,
        customerName: purchaseOrder?.customerName ?? null,
      });
    });
  }

  const payments = await ctx.db.query("payments").take(MAX_ROWS);
  const invoices = await ctx.db.query("invoices").take(MAX_ROWS);
  const invoicesById = new Map(invoices.map((invoice) => [invoice.invoiceId, invoice]));

  return payments.map((payment) => {
    const invoice = invoicesById.get(payment.invoiceId);
    const dueDate = invoice?.dueDate ?? null;
    const paymentDelayDays =
      typeof dueDate === "string" ? daysBetween(dueDate, payment.paymentDate) : null;

    return toQueryRow({
      ...payment,
      dueDate,
      paymentDelayDays,
      isLate: typeof paymentDelayDays === "number" ? paymentDelayDays > 0 : false,
    });
  });
}

export const runStructuredQuery = internalQuery({
  args: { spec: structuredQuerySpecValidator },
  handler: async (ctx, args) => {
    const spec = normalizeQuerySpec(args.spec);
    const table = validateSpec(spec);
    const limit = spec.limit ?? 100;

    const sourceRows = await readRows(ctx, table);
    const filteredRows = applyFilters(sourceRows, spec.filters);
    const aggregatedRows = applyAggregate(filteredRows, spec);
    const sortedRows = applySort(aggregatedRows, spec.sort);
    const rows = sortedRows.slice(0, limit);

    return {
      spec,
      rowCount: rows.length,
      matchedRowCount: filteredRows.length,
      rows,
    };
  },
});

export const describeQueryableSchema = internalQuery({
  args: {},
  handler: async () => {
    return schemaDescription;
  },
});
