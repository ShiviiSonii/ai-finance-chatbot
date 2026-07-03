import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// using poId, invoiceId, customerId for human readable labels

export default defineSchema({
  purchaseOrders: defineTable({
    poId: v.string(),
    customerId: v.string(),
    customerName: v.string(),
    amount: v.number(),
    currency: v.string(),
    orderDate: v.string(),
  })
    .index("by_poId", ["poId"])
    .index("by_customerId", ["customerId"]),

  invoices: defineTable({
    invoiceId: v.string(),
    poId: v.string(),
    amount: v.number(),
    currency: v.string(),
    dueDate: v.string(),
    status: v.union(v.literal("Paid"), v.literal("Unpaid")),
  })
    .index("by_invoiceId", ["invoiceId"])
    .index("by_poId", ["poId"])
    .index("by_status", ["status"]),

  payments: defineTable({
    paymentId: v.string(),
    invoiceId: v.string(),
    customerId: v.string(),
    customerName: v.string(),
    amount: v.number(),
    currency: v.string(),
    paymentDate: v.string(),
  })
    .index("by_paymentId", ["paymentId"])
    .index("by_invoiceId", ["invoiceId"])
    .index("by_customerId", ["customerId"]),
});
