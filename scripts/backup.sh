#!/bin/bash
# MySQL 백업 스크립트
#
# 사용법:
#   ./scripts/backup.sh                  # 기본 설정으로 백업
#   ./scripts/backup.sh -o /backups      # 출력 디렉터리 지정
#
# 환경변수 (미설정 시 .env 또는 docker-compose 참조):
#   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
#   BACKUP_RETENTION_DAYS=30 (기본 30일)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# 안전 검증: BACKUP_DIR이 존재하지 않으면 생성
mkdir -p "$BACKUP_DIR"

# .env 파일에서 DB_PASSWORD 로드 (환경변수가 없을 경우)
if [ -z "${DB_PASSWORD:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
  source <(grep DB_PASSWORD "$PROJECT_DIR/.env")
fi

# DB 접속 정보 (환경변수 우선, .env 차선)
DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-gameuser}"
DB_NAME="${DB_NAME:-idle_game}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"
TMP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz.tmp"

echo "[$(date)] Starting backup: $DB_NAME"

if [ -n "${DB_PASSWORD:-}" ]; then
  # 임시 파일에 먼저 쓰고 성공 시 rename (불완전 파일 방지)
  MYSQL_PWD="$DB_PASSWORD" mysqldump \
    -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
    --single-transaction --routines --triggers --events \
# MySQL 덤프는 DB 데이터만 포함 (JWT secret, .env, 로그, 임시 파일 제외)
# --single-transaction: InnoDB 일관성 백업 (non-blocking)
    && mv "$TMP_FILE" "$BACKUP_FILE" \
    || { rm -f "$TMP_FILE"; echo "ERROR: Backup failed"; exit 1; }
else
  echo "ERROR: DB_PASSWORD not set"
  exit 1
fi

SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
CHECKSUM=$(sha256sum "$BACKUP_FILE" | cut -d' ' -f1)
chmod 600 "$BACKUP_FILE"  # 소유자만 읽기
APP_VERSION="${APP_VERSION:-unknown}"
MIGRATION_VERSION="$(ls "$PROJECT_DIR/src/db/migrations/" 2>/dev/null | tail -1 || echo unknown)"

echo "[$(date)] Backup complete: $BACKUP_FILE ($SIZE, sha256:$CHECKSUM)"

# Backup manifest 로그
MANIFEST_FILE="$BACKUP_DIR/backup_manifest.log"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | $DB_NAME | $TIMESTAMP | $SIZE | $CHECKSUM | app=$APP_VERSION | migration=$MIGRATION_VERSION" >> "$MANIFEST_FILE"

# 오래된 백업 정리
DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo "[$(date)] Cleaned $DELETED old backups (retention: ${RETENTION_DAYS}d)"

# 최신 백업 symlink
ln -sf "$(basename "$BACKUP_FILE")" "$BACKUP_DIR/${DB_NAME}_latest.sql.gz"
echo "[$(date)] Updated latest symlink"
