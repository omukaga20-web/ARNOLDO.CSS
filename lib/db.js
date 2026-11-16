const { drizzle } = require("drizzle-orm/node-postgres");
const { Pool } = require("pg");
const { payheroOrders } = require("./schema");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to process checkout.");
}

const pool = global.payheroPool || new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  idleTimeoutMillis: 30000,
});

global.payheroPool = pool;

const db = global.payheroDb || drizzle(pool, { schema: { payheroOrders } });
global.payheroDb = db;

module.exports = { db };
