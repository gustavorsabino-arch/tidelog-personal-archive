-- Migration: Create user_access table
-- Run this once on server startup

CREATE TABLE IF NOT EXISTS user_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'restricted' CHECK(role IN ('admin', 'restricted')),
  budget_department TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Insert default admin
INSERT OR IGNORE INTO user_access (email, role) 
VALUES ('gustavo@orca.so', 'admin');
