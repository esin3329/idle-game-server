# ERD 및 아키텍처 문서 누락 분석

> 기준: 포트폴리오 기술 문서 수준

---

## 📊 현재 상태

```
문서화된 아키텍처 자료: 0개
```

| 항목 | 상태 |
|------|:---:|
| ERD (Entity Relationship Diagram) | ❌ |
| 시스템 아키텍처 다이어그램 | ❌ |
| API 흐름도 | ❌ |
| 데이터 모델 명세 | ❌ |
| 디렉토리 구조도 | ❌ |
| 배포 아키텍처 | ❌ |

---

## 🔴 Critical

### 1. ERD 없음

현재 데이터 모델은 `Player` 단일 엔티티지만, 이를 시각화한 문서가 없음.

```mermaid
erDiagram
    Player {
        string id PK "UUID"
        string nickname "닉네임"
        int electricity "보유 전기"
        int electricityPerSecond "초당 생산량"
        string lastClaimedAt "마지막 수집 시간"
        string createdAt "생성 시간"
        string updatedAt "수정 시간"
    }
```

### 2. 시스템 아키텍처 다이어그램 없음

전체 시스템 구성도가 없어 프로젝트 파악이 코드를 읽어야만 가능.

```mermaid
graph TB
    Client[클라이언트] -->|HTTP| Hono[Hono Server]
    Hono --> Routes[라우트 계층]
    Routes --> Store[인메모리 Store]
    Hono --> Middleware[미들웨어]
    Middleware --> Logging[로깅]
    Middleware --> Auth[인증]
    Middleware --> CORS[CORS]
```

---

## 🟡 High

### 3. API 흐름도 없음

주요 비즈니스 로직의 요청 흐름을 시각화한 문서 없음.

```mermaid
sequenceDiagram
    Client->>Server: POST /api/players/:id/claim
    Server->>Store: getPlayer(id)
    Store-->>Server: Player
    Server->>Server: 경과시간 계산 (max 8h)
    Server->>Server: 생산량 = 경과시간 × electricityPerSecond
    Server->>Store: updatePlayer(electricity, lastClaimedAt)
    Store-->>Server: Updated Player
    Server-->>Client: { player, claimed, elapsed }
```

### 4. 확장 ERD 없음

현재는 Player 1개 테이블이지만, DB 도입 시 필요한 테이블들:

```mermaid
erDiagram
    Player ||--o{ BattleHistory : "전투"
    Player ||--o{ UpgradeHistory : "업그레이드"
    Player {
        string id PK
        string apiKey
        string nickname
        int electricity
        int electricityPerSecond
        string lastClaimedAt
        string createdAt
        string updatedAt
    }
    BattleHistory {
        string id PK
        string playerId FK
        string enemyName
        int enemyPower
        int playerPower
        bool won
        int reward
        string createdAt
    }
    UpgradeHistory {
        string id PK
        string playerId FK
        int fromLevel
        int toLevel
        int cost
        string createdAt
    }
```

---

## 🟢 Medium

### 5. 데이터 모델 명세 없음

각 필드의 제약조건, 기본값, 용도를 표로 정리한 문서 없음.

### 6. 배포 아키텍처 없음

Docker 도입 시 컨테이너 구성도 필요.

---

## 🎯 빠른 액션 (15분)

| 순서 | 작업 |
|:---:|------|
| 1 | Mermaid ERD (Player) → README에 추가 |
| 2 | 시스템 아키텍처 다이어그램 |
| 3 | Claim API 시퀀스 다이어그램 |
| 4 | DB 도입 대비 확장 ERD |
| 5 | 데이터 모델 명세 테이블 |
