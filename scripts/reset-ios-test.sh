#!/bin/bash
# Reset iOS test data for development
# NOTE: Server uses sql.js (in-memory). Must restart server after clearing!
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="${DB_PATH:-$PROJECT_DIR/data/porizo.db}"

echo "Clearing iOS enrollment sessions and rate limits from $DB_PATH..."
sqlite3 "$DB_PATH" "DELETE FROM enrollment_sessions WHERE user_id LIKE 'ios_%'"
sqlite3 "$DB_PATH" "DELETE FROM rate_limits WHERE user_id LIKE 'ios_%'"

echo "Restarting server to load fresh database..."
pkill -f "node.*src/server.js" 2>/dev/null
sleep 1
cd "$PROJECT_DIR" && npm run dev > /tmp/porizo-server.log 2>&1 &
sleep 2

if lsof -i :3000 >/dev/null 2>&1; then
  echo "Done. Server restarted. iOS users can now enroll again."
else
  echo "Warning: Server may not have started. Check logs at /tmp/porizo-server.log"
fi
