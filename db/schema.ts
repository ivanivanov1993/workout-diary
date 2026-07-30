import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("profiles_email_idx").on(table.email)],
);

export const userStates = sqliteTable(
  "user_states",
  {
    ownerId: text("owner_id").primaryKey(),
    payload: text("payload").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("user_states_updated_idx").on(table.updatedAt)],
);

export const syncOperations = sqliteTable(
  "sync_operations",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("sync_operations_owner_idx").on(table.ownerId)],
);
