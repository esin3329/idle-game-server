#!/bin/bash
# MySQL 복원 스크립트
#
# 사용법:
#   ./scripts/restore.sh backups/idle_game_20260101_120000.sql.gz
#   ./scripts/restore.sh latest                     # 최신 백업 사용
#   DB_PASSWORD=xxx ./scripts/restore.sh ...         # 환경변수로 비밀번호 전달
#
# 주의: 기존 데이터베이스를 덮어쓰므로 운영 환경에서는 주의해서 사용
# 비밀번호: 환경변수 DB_PASSWORD 또는 .env 파일 사용 (명령줄 인수 노출 안 함)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"

# .env 파일에서 DB_PASSWORD 로드 (환경변수가 없을 경우)
if [ -z "${DB_PASSWORD:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
  source <(grep DB_PASSWORD "$PROJECT_DIR/.env")
fi

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-gameuser}"
DB_NAME="${DB_NAME:-idle_game}"

INPUT="$1"
if [ -z "$INPUT" ]; then
  echo "Usage: $0 <backup_file.sql.gz | latest>"
  exit 1
fi

if [ "$INPUT" = "latest" ]; then
  INPUT="$BACKUP_DIR/${DB_NAME}_latest.sql.gz"
fi

if [ ! -f "$INPUT" ]; then
  echo "ERROR: Backup file not found: $INPUT"
  exit 1
fi

echo "[$(date)] WARNING: This will overwrite database '$DB_NAME'"
echo "  Backup: $INPUT"
read -rp "Continue? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "[$(date)] Restoring: $DB_NAME ← $INPUT"

gunzip -c "$INPUT" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"

echo "[$(date)] Restore complete"

# 마이그레이션 재실행 (스키마 최신화)
echo "[$(date)] Running migrations..."
cd "$PROJECT_DIR"
npm run db:migrate

echo "[$(date)] Restore and migration complete"
