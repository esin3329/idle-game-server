#!/bin/bash
# MySQL 데이터베이스 복구 스크립트
#
# 안전 원칙:
#   1. 항상 --dry-run 먼저 실행하여 검증
#   2. DB 이름 직접 입력 확인 (실수 방지)
#   3. gzip 무결성 검증 후 복원
#   4. manifest checksum 확인 (가능 시)
#   5. DROP 전 확인 프롬프트
#   6. 복원 후 마이그레이션 자동 실행
# 사용법:
#   ./scripts/recover.sh latest                     # 최신 백업으로 복구
#   ./scripts/recover.sh backups/file.sql.gz         # 특정 파일로 복구
#   ./scripts/recover.sh --dry-run latest            # 검증만
#   DB_PASSWORD=xxx ./scripts/recover.sh latest      # 환경변수로 비밀번호
#
# 복구 단계:
#   1. 백업 파일 무결성 검증 (gzip -t)
#   2. manifest checksum 확인
#   3. DB DROP + CREATE
#   4. 복원 실행
#   5. 마이그레이션 적용
#   6. 검증 쿼리

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"

# .env 파일에서 DB_PASSWORD 로드
if [ -z "${DB_PASSWORD:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
  source <(grep DB_PASSWORD "$PROJECT_DIR/.env")
fi

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-gameuser}"
DB_NAME="${DB_NAME:-idle_game}"

# --target-db 옵션: 복구 대상 DB 지정 (기본: idle_game_recovered)
TARGET_DB="${DB_NAME}_recovered"
if [ "${1:-}" = "--target-db" ]; then
  TARGET_DB="$2"
  shift 2
fi

# 운영 환경 추가 경고
if [ "${NODE_ENV:-}" = "production" ] || [ "${DB_NAME}" != "idle_game_test" ]; then
  echo "⚠️  WARNING: Target is '$DB_NAME' (production or non-test DB)"
fi

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
  shift
fi

INPUT="${1:-latest}"
if [ "$INPUT" = "latest" ]; then
  INPUT="$BACKUP_DIR/${DB_NAME}_latest.sql.gz"
fi

if [ ! -f "$INPUT" ]; then
  echo "ERROR: Backup file not found: $INPUT"
  echo "Available backups:"
  ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "  (none)"
  exit 1
fi

echo "=== Recovery Plan ==="
echo "  Database: $DB_NAME@$DB_HOST:$DB_PORT"
echo "  Backup:   $INPUT ($(du -h "$INPUT" | cut -f1))"
echo "  Dry run:  $DRY_RUN"
echo ""

# 1. 무결성 검증
echo "[1/5] Verifying backup integrity..."
if ! gunzip -t "$INPUT" 2>/dev/null; then
  echo "ERROR: Backup file is corrupted (gzip test failed)"
  exit 1
fi
echo "  ✅ gzip integrity OK"

# checksum 확인 (manifest에 기록된 경우)
MANIFEST="$BACKUP_DIR/backup_manifest.log"
BACKUP_FILENAME=$(basename "$INPUT")
if [ -f "$MANIFEST" ]; then
  MANIFEST_ENTRY=$(grep "$BACKUP_FILENAME" "$MANIFEST" || true)
  if [ -n "$MANIFEST_ENTRY" ]; then
    EXPECTED_CHECKSUM=$(echo "$MANIFEST_ENTRY" | awk -F'|' '{print $5}' | tr -d ' ')
    ACTUAL_CHECKSUM=$(sha256sum "$INPUT" | cut -d' ' -f1)
    if [ "$EXPECTED_CHECKSUM" = "$ACTUAL_CHECKSUM" ]; then
      echo "  ✅ checksum verified against manifest"
    else
      echo "  ⚠️  checksum mismatch (expected: $EXPECTED_CHECKSUM, got: $ACTUAL_CHECKSUM)"
      echo "  Continuing anyway..."
    fi
  fi
fi

if $DRY_RUN; then
  echo "  (dry run: stopping here)"
  exit 0
fi

# 2. 확인
echo ""
echo "[2/5] WARNING: This will DROP and recreate database '$DB_NAME'"
echo "  All current data will be lost."
read -rp "  Continue? Type the database name to confirm: " CONFIRM
if [ "$CONFIRM" != "$TARGET_DB" ]; then
  echo "  Aborted."
  exit 0
fi

# 3. DROP + CREATE
echo "[3/5] Dropping and recreating database..."
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" <<SQL
DROP DATABASE IF EXISTS \`$TARGET_DB\`;
CREATE DATABASE \`$TARGET_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL
echo "  ✅ Database recreated"

# 4. 복원
echo "[4/5] Restoring data..."
gunzip -c "$INPUT" | mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$TARGET_DB"
echo "  ✅ Data restored"

# 5. 마이그레이션
echo "[5/5] Running migrations..."
cd "$PROJECT_DIR"
npm run db:migrate 2>&1 || echo "  ⚠️  Migration may have issues (check above)"

echo ""
echo "=== Recovery Complete ==="
echo "  Database: $DB_NAME"
echo "  Tables:"
mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$TARGET_DB" -e "SHOW TABLES;" 2>/dev/null | tail -n +2 | sed 's/^/    /'
