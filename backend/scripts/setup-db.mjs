import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qmgfcirrgwzcmmyjnecn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtZ2ZjaXJyZ3d6Y21teWpuZWNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODAzNjY3NCwiZXhwIjoyMDgzNjEyNjc0fQ.0JZ7RnQAauLcI2SZm5SW8AblhN8EgUApPA-8NovLqXw';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function setup() {
  // We'll use individual table creation attempts with the Supabase SQL API
  // Supabase service_role key allows us to use the pg_net extension or direct SQL

  const tables = [
    {
      name: 'users',
      check: async () => {
        const { error } = await supabase.from('users').select('username').limit(1);
        return !error || !error.message.includes('does not exist');
      }
    },
    {
      name: 'match_history',
      check: async () => {
        const { error } = await supabase.from('match_history').select('id').limit(1);
        return !error || !error.message.includes('does not exist');
      }
    },
    {
      name: 'active_rooms',
      check: async () => {
        const { error } = await supabase.from('active_rooms').select('id').limit(1);
        return !error || !error.message.includes('does not exist');
      }
    },
    {
      name: 'rating_history',
      check: async () => {
        const { error } = await supabase.from('rating_history').select('id').limit(1);
        return !error || !error.message.includes('does not exist');
      }
    }
  ];

  for (const t of tables) {
    const exists = await t.check();
    console.log(`Table ${t.name}: ${exists ? 'EXISTS' : 'MISSING'}`);
  }

  console.log('\n=== Please create missing tables in Supabase SQL Editor ===');
  console.log('Go to: https://supabase.com/dashboard/project/qmgfcirrgwzcmmyjnecn/sql/new');
  console.log('And run the SQL below:\n');

  console.log(`
CREATE TABLE IF NOT EXISTS users (
  username text PRIMARY KEY,
  password_hash text NOT NULL,
  rating int DEFAULT 1500,
  wins int DEFAULT 0,
  losses int DEFAULT 0,
  surrenders int DEFAULT 0,
  games_played int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_history (
  id serial PRIMARY KEY,
  room_id text,
  winner_team text,
  is_surrender boolean DEFAULT false,
  team_a_players jsonb,
  team_b_players jsonb,
  team_a_score float DEFAULT 0,
  team_b_score float DEFAULT 0,
  dataset text,
  rating_changes jsonb DEFAULT '{}',
  ended_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS active_rooms (
  id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rating_history (
  id serial PRIMARY KEY,
  username text REFERENCES users(username),
  rating int,
  match_id int REFERENCES match_history(id),
  recorded_at timestamptz DEFAULT now()
);
  `);
}

setup();
