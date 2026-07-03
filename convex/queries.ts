import { query } from "./_generated/server";

export const listPurchaseOrders = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("purchaseOrders").collect();
  },
});

export const listInvoices = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("invoices").collect();
  },
});

export const listPayments = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("payments").collect();
  },
});
