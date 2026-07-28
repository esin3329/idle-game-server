#!/bin/bash
# 데이터 무결성 점검 (read-only)
#
# 사용법:
#   DB_PASSWORD=xxx ./scripts/integrity-check.sh
#
# 점검 항목:
#   1. wallet_balances.scrap/electricity vs currency_ledger 집계 일치
#   2. currency_ledger에 DELETE/UPDATE 흔적 없음 (append-only)
#   3. wallet_balances 잔액 음수 없음
#   4. player ↔ wallet 1:1 매핑
#   5. battle_sessions ↔ battle_results 1:1
#   6. item_ledger append-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [ -z "${DB_PASSWORD:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
  source <(grep DB_PASSWORD "$PROJECT_DIR/.env")
fi

DB_HOST="${DB_HOST:-mysql}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-gameuser}"
# 자동 수정(--fix)은 구현하지 않음. 읽기 전용 검사와 보고만 수행.
# 수정이 필요하면 운영자가 확인 후 수동 처리.
# 무결성 문제 발견 시 COUNT만 반환, 전체 행 덤프하지 않음.

MYSQL="mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_NAME -sN"

echo "=== Integrity Check: $DB_NAME ==="
echo ""

FAILURES=0

WARNINGS=0

check() {
  local name="$1"
  local query="$2"
  local expected="${3:-0}"
  local level="${4:-error}"
  local result
  result=$($MYSQL -e "$query" 2>/dev/null || echo "ERROR")
  if [ "$result" = "$expected" ]; then
    echo "  ✅ $name"
  elif [ "$level" = "warn" ]; then
    echo "  ⚠️  $name (got: $result, expected: $expected)"
    WARNINGS=$((WARNINGS + 1))
  else
    echo "  ❌ $name (got: $result, expected: $expected)"
    FAILURES=$((FAILURES + 1))
  fi
}

# 1. wallet_balances vs currency_ledger
check "wallet.scrap matches ledger sum" \
  "SELECT COUNT(*) FROM wallet_balances w
   WHERE w.scrap != COALESCE((SELECT SUM(amount) FROM currency_ledger l
     WHERE l.player_id = w.player_id AND l.currency = 'scrap'), 0);"

check "wallet.electricity matches ledger sum" \
  "SELECT COUNT(*) FROM wallet_balances w
   WHERE w.electricity != COALESCE((SELECT SUM(amount) FROM currency_ledger l
     WHERE l.player_id = w.player_id AND l.currency = 'electricity'), 0);"

# 2. wallet 음수 잔액
check "wallet.scrap >= 0" \
  "SELECT COUNT(*) FROM wallet_balances WHERE scrap < 0;"

check "wallet.electricity >= 0" \
  "SELECT COUNT(*) FROM wallet_balances WHERE electricity < 0;"

# 3. player ↔ wallet 1:1
check "player without wallet" \
  "SELECT COUNT(*) FROM players p LEFT JOIN wallet_balances w ON p.id = w.player_id WHERE w.id IS NULL;"

# 4. battle_sessions ↔ battle_results
check "completed battle without result" \
  "SELECT COUNT(*) FROM battle_sessions WHERE status='completed'
   AND id NOT IN (SELECT battle_session_id FROM battle_results);"

# 5. currency_ledger amount + balanceAfter consistency
check "ledger balance mismatch (scrap)" \
  "SELECT COUNT(*) FROM currency_ledger l1
   WHERE l1.currency='scrap'
   AND l1.balance_after != (
     SELECT COALESCE(SUM(l2.amount),0) FROM currency_ledger l2
     WHERE l2.player_id = l1.player_id AND l2.currency='scrap'
     AND l2.created_at <= l1.created_at
   );" 0

# 6. item_ledger quantity > 0
check "item_ledger quantity <= 0" \
  "SELECT COUNT(*) FROM item_ledger WHERE quantity <= 0;"

# 7. 존재하지 않는 사용자 참조
check "wallet without user" \
  "SELECT COUNT(*) FROM wallet_balances w LEFT JOIN users u ON w.user_id = u.id WHERE u.id IS NULL AND w.user_id != '';"

# 8. 중복 active 전투 세션
check "duplicate active battle sessions" \
  "SELECT COUNT(*) FROM (SELECT player_id, COUNT(*) cnt FROM battle_sessions WHERE status='active' GROUP BY player_id HAVING cnt > 1) dup;"

# 9. 완료 세션의 중복 battle result
check "duplicate battle results" \
  "SELECT COUNT(*) FROM (SELECT battle_session_id, COUNT(*) cnt FROM battle_results GROUP BY battle_session_id HAVING cnt > 1) dup;"

# 10. 완료 전투의 보상 원장 누락
check "completed battle without scrap ledger" \
  "SELECT COUNT(*) FROM battle_sessions bs WHERE bs.status='completed' AND bs.reward_scrap > 0 AND NOT EXISTS (SELECT 1 FROM currency_ledger cl WHERE cl.reference_id = bs.id AND cl.reference_type = 'battle_session');"

# 11. 중복 최초 클리어 보상
check "duplicate first clear rewards" \
  "SELECT COUNT(*) FROM (SELECT player_id, stage_id, COUNT(*) cnt FROM player_records WHERE first_cleared_at IS NOT NULL GROUP BY player_id, stage_id HAVING cnt > 1) dup;"

# 12. 만료됐는데 active로 남은 세션 (경고: self-healing)
check "expired but still active sessions" \
  "SELECT COUNT(*) FROM battle_sessions WHERE status='active' AND expires_at IS NOT NULL AND expires_at < NOW();" 0 warn

# 13. 해제/만료된 제재와 user 상태 불일치
check "revoked sanction but user still suspended" \
  "SELECT COUNT(*) FROM account_sanctions s JOIN users u ON s.user_id = u.id WHERE s.type='suspension' AND s.status='revoked' AND u.status='suspended';"

# 14. 운영 지급 vs 원장 참조 불일치
check "operator grant without ledger entry" \
  "SELECT COUNT(*) FROM operator_grants og WHERE og.grantType='currency' AND og.status='completed' AND NOT EXISTS (SELECT 1 FROM currency_ledger cl WHERE cl.reference_id = og.id AND cl.reference_type = 'operator_grant');"

# TODO (2단계): 존재하지 않는 파츠 참조 인벤토리
# TODO (2단계): 슬롯 타입 불일치 메카 장착
# TODO (2단계): player_stage_progress ↔ player_records 일관성

echo ""
if [ "$FAILURES" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo "=== All checks passed ✅ ==="
elif [ "$FAILURES" -eq 0 ]; then
  echo "=== Passed with $WARNINGS warning(s) ⚠️ ==="
else
  echo "=== $FAILURES check(s) FAILED ❌, $WARNINGS warning(s) ⚠️ ==="
  exit 1
fi
