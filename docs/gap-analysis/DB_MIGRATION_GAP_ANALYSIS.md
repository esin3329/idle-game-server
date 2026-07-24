# DB 마이그레이션 누락 분석

> 기준: Drizzle ORM + SQLite, 포트폴리오 수준

---

## 📊 현재 상태

```typescript
// store.ts - 유일한 "데이터 계층"
const players = new Map<string, Player>(); // ❌ 인메모리, 서버 재시작 시 소멸
```

| 항목 | 상태 |
|------|:---:|
| 데이터베이스 | ❌ 없음 (Map) |
| ORM | ❌ 없음 |
| 스키마 정의 | ❌ TypeScript interface만 존재 |
| 마이그레이션 | ❌ 불가능 |
| 시드 데이터 | ❌ 없음 |
| 영속성 | ❌ 휘발성 |
| 연결 관리 | ❌ 없음 |
| 테스트 격리 | ❌ 전역 Map 공유 |

---

## 🔴 Critical: 구조적 누락

### 1. 데이터 영속성 부재

**현상**: 서버 재시작 → 모든 플레이어 데이터 영구 소멸

```
npm run dev  → 플레이어 생성
Ctrl+C       → 모든 데이터 삭제됨
npm run dev  → 빈 상태
```

**방안**: SQLite 파일 DB - 설치 불필요, 파일 하나로 동작, 포트폴리오용 최적

---

### 2. 스키마 정의 없음

**현재**: TypeScript `interface Player` 로만 구조 정의

```typescript
// types.ts - DB와 무관한 순수 TS 타입
export interface Player {
  id: string;
  nickname: string;
  electricity: number;
  electricityPerSecond: number;
  lastClaimedAt: string;
  createdAt: string;
  updatedAt: string;
}
```

**문제점**:
- 실제 DB 제약조건 (PK, NOT NULL, DEFAULT) 정의 불가
- 타입과 DB 스키마 불일치 가능성
- 다른 언어/도구에서 스키마 재사용 불가

**필요**: Drizzle 스키마
```typescript
// db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  nickname: text('nickname').notNull(),
  electricity: integer('electricity').notNull().default(0),
  electricityPerSecond: integer('electricity_per_second').notNull().default(1),
  lastClaimedAt: text('last_claimed_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

---

### 3. 마이그레이션 인프라 전무

| 필요 기능 | 현재 | 방안 |
|------|:---:|------|
| 스키마 버전 관리 | ❌ | `drizzle-kit generate` |
| 마이그레이션 실행 | ❌ | `drizzle-kit migrate` |
| 롤백 | ❌ | 수동 rollback.sql |
| 마이그레이션 히스토리 | ❌ | `drizzle/__drizzle_migrations` 테이블 |
| CI 연동 | ❌ | GitHub Actions에서 `db:migrate` |

**필요한 npm scripts**:
```json
{
  "db:generate": "drizzle-kit generate",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "db:seed": "tsx src/db/seed.ts"
}
```

---

### 4. Repository 패턴 부재

**현재**: store.ts 함수가 라우트에 직접 import 되어 강결합

```typescript
// routes.ts
import { createPlayer, getPlayer, ... } from './store.js';
// → Map에 직접 의존, DB로 교체 시 모든 라우트 수정 필요
```

**필요**: Repository 인터페이스로 추상화
```typescript
// db/player.repository.ts
export class PlayerRepository {
  constructor(private db: DrizzleDB) {}
  
  async findById(id: string): Promise<Player | undefined> {
    return this.db.select().from(players).where(eq(players.id, id)).get();
  }
  
  async create(data: InsertPlayer): Promise<Player> { ... }
  async update(id: string, data: Partial<Player>): Promise<Player> { ... }
  async findAll(): Promise<Player[]> { ... }
}
```

---

## 🟡 High: 데이터 모델링 누락

### 5. Player 외 테이블 없음

게임 확장 시 필요한 테이블:

```typescript
// 현재 없지만 필요할 가능성이 높은 테이블
- battle_history    // 전투 기록 (id, player_id, enemy, won, reward, created_at)
- upgrade_history   // 업그레이드 기록
- rankings_snapshot  // 랭킹 스냅샷 (주기적 저장)
```

### 6. 인덱스 설계 부재

```sql
-- 랭킹 쿼리 최적화
CREATE INDEX idx_players_electricity ON players(electricity DESC);

-- 닉네임 검색 (미래 기능)
CREATE INDEX idx_players_nickname ON players(nickname);
```

### 7. 데이터 타입 불일치 위험

| 필드 | TS 타입 | SQLite 타입 | 문제 |
|------|------|------|------|
| `electricity` | `number` | `INTEGER` | JS number는 float → 정수 정합성 |
| `electricityPerSecond` | `number` | `INTEGER` | 0.1 같은 소수 저장 불가 |
| 날짜 필드 | `string` (ISO) | `TEXT` | 타임존 일관성 검증 없음 |

---

## 🟢 Medium: 운영 측면

### 8. 연결 관리 없음

```typescript
// 필요:
- connection pool (SQLite는 단일 연결이지만 WAL 모드 고려)
- graceful shutdown 시 연결 종료
- connection timeout 설정
- WAL 모드 활성화 (읽기/쓰기 동시성)
```

### 9. 시드 데이터 없음

```bash
# 개발/테스트용 초기 데이터
npm run db:seed
# → 100명의 더미 플레이어 생성
```

### 10. 테스트 DB 격리 전략 없음

**현재**: store.test.ts가 전역 Map을 beforeEach로 수동 초기화

**필요**: 테스트용 인메모리 SQLite (`:memory:`) 또는 트랜잭션 롤백
```typescript
// vitest setup
beforeEach(async () => {
  db = createInMemoryDB();
  await migrate(db);
});
```

---

## 🔵 Low: DevOps

| # | 누락 | 설명 |
|:---:|------|------|
| 11 | **마이그레이션 CI** | PR 시 `db:generate` diff 체크 |
| 12 | **백업 전략** | SQLite 파일 복사 → `.dump` |
| 13 | **데이터 정합성 검증** | `electricity >= 0` CHECK 제약조건 |
| 14 | **마이그레이션 가이드** | README에 DB 셋업 문서 |
| 15 | **환경별 DB 분리** | `dev.db` / `test.db` / `prod.db` |

---

## 📁 제안 디렉토리 구조

```
src/
├── db/
│   ├── schema.ts            # Drizzle 테이블 정의
│   ├── index.ts             # DB 연결 + 의존성 주입
│   ├── migrate.ts           # 마이그레이션 실행 스크립트
│   ├── seed.ts              # 시드 데이터
│   ├── player.repository.ts  # Player CRUD
│   ├── battle.repository.ts  # 전투 기록 (확장)
│   └── migrations/          # drizzle-kit 생성 SQL 파일들
│       ├── 0000_init.sql
│       └── meta/
├── ...
drizzle.config.ts             # Drizzle 설정
```

---

## 🎯 빠른 액션 (40분)

| 순서 | 작업 | 세부 |
|:---:|------|------|
| 1 | **SQLite + Drizzle 설치** | `npm i drizzle-orm better-sqlite3 && npm i -D drizzle-kit @types/better-sqlite3` |
| 2 | **`drizzle.config.ts` 작성** | out: `./src/db/migrations`, schema: `./src/db/schema.ts` |
| 3 | **`schema.ts` 작성** | `players` 테이블 정의 |
| 4 | **초기 마이그레이션 생성** | `npx drizzle-kit generate` |
| 5 | **`player.repository.ts` 작성** | store.ts → async Repository로 포팅 |
| 6 | **`db/index.ts` 연결 관리** | 싱글톤 DB 인스턴스 + graceful shutdown |
| 7 | **routes.ts 수정** | `store.*` → `repo.*` (async 적용) |
| 8 | **테스트 수정** | Map 초기화 → 인메모리 SQLite 초기화 |
| 9 | **`db:generate`, `db:migrate`, `db:seed` scripts 추가** |
| 10 | **README에 DB 셋업 가이드 추가** |
