import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: "-c client_encoding=UTF8 -c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000",
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    query_timeout: 30000,
});
