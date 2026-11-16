const {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} = require("drizzle-orm/pg-core");

const payheroOrders = pgTable("payhero_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  externalReference: text("external_reference").notNull().unique(),
  phoneNumber: text("phone_number").notNull(),
  amount: integer("amount").notNull(),
  items: jsonb("items").notNull(),
  status: text("status").notNull().default("pending"),
  providerReference: text("provider_reference"),
  mpesaReceipt: text("mpesa_receipt"),
  checkoutRequestId: text("checkout_request_id"),
  callbackPayload: jsonb("callback_payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

module.exports = { payheroOrders };
