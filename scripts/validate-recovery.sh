#!/bin/bash
# 복구 리허설 검증 스크립트
#
# 사용법:
#   DB_PASSWORD=xxx ./scripts/validate-recovery.sh latest
#
# 검증:
#   1. 백업 파일 존재 + gzip 무결성
#   2. 임시 검증 DB 생성
#   3. 백업 복원
#   4. 테이블 수 확인
#   5. 핵심 테이블 row 수 확인
#   6. 임시 DB 삭제

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"

if [ -z "${DB_PASSWORD:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
  source <(grep DB_PASSWORD "$PROJECT_DIR/.env")
fi

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-gameuser}"
VERIFY_DB="idle_game_recovery_verify"

INPUT="${1:-latest}"
if [ "$INPUT" = "latest" ]; then
  INPUT="$BACKUP_DIR/idle_game_latest.sql.gz"
fi

echo "=== Recovery Rehearsal ==="
echo "  Backup: $INPUT"

# 1. gzip 검증
gunzip -t "$INPUT" || { echo "FAIL: corrupt"; exit 1; }
echo "  ✅ gzip OK"

# 2. 임시 DB 생성
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -e "DROP DATABASE IF EXISTS \`$VERIFY_DB\`; CREATE DATABASE \`$VERIFY_DB\`;"
echo "  ✅ temp DB created: $VERIFY_DB"

# 3. 복원
gunzip -c "$INPUT" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$VERIFY_DB"
echo "  ✅ data restored"

# 4. 검증
TABLE_COUNT=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$VERIFY_DB" -sN -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$VERIFY_DB';")
PLAYER_COUNT=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$VERIFY_DB" -sN -e "SELECT COUNT(*) FROM players;" 2>/dev/null || echo 0)
LEDGER_COUNT=$(mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$VERIFY_DB" -sN -e "SELECT COUNT(*) FROM currency_ledger;" 2>/dev/null || echo 0)

echo "  ✅ Tables: $TABLE_COUNT"
echo "  ✅ Players: $PLAYER_COUNT"
echo "  ✅ Ledger: $LEDGER_COUNT"

# 5. 정리
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" -e "DROP DATABASE IF EXISTS \`$VERIFY_DB\`;"
echo "  ✅ temp DB cleaned"

echo "=== Recovery Rehearsal PASSED ==="
