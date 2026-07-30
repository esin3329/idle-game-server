# 🎮 idle-game-server Admin Dashboard

> React + Vite + TypeScript + Tailwind CSS 기반 관리자 대시보드

---

## 개요

게임 서버 운영을 위한 웹 기반 관리자 인터페이스입니다.
백엔드 Admin API(`/admin/*`)를 호출하여 사용자 관리, 제재, 재화 지급, 보안 이벤트 모니터링, 감사 로그 조회 기능을 제공합니다.

---

## 화면 구성

| 화면 | 경로 | 주요 기능 |
|------|------|-----------|
| **대시보드** | `/dashboard` | 총 사용자, 최근 지급 내역, 감사 로그 요약 |
| **사용자 검색** | `/users` | 이메일/닉네임 검색, 상태별 필터, 페이지네이션 |
| **사용자 상세** | `/users/:id` | 재화 원장, 제재 내역, 아이템 원장, 전투 기록 (탭) |
| **계정 제재** | `/sanctions` | 사용자 선택 → 제재 추가/철회 |
| **재화 지급** | `/grants` | 사용자 선택 → electricity/scrap 지급 |
| **보안 이벤트** | `/security` | 보안 이벤트 목록 + 검토 처리 |
| **감사 로그** | `/audit-logs` | 운영자 행위 감사 로그 조회 |

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Framework | React 18 |
| Build | Vite 5 |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS 3 |
| Routing | react-router-dom v6 |
| Data Fetching | @tanstack/react-query |
| Auth | JWT (백엔드 연동) |

---

## 실행

```bash
# 1. 의존성 설치
cd admin && npm install

# 2. 개발 서버 실행 (포트 5174, API 프록시 → localhost:3000)
npm run dev

# 3. 프로덕션 빌드
npm run build
```

### 프록시 설정

개발 서버는 `/api/*` 요청을 `http://localhost:3000`으로 프록시합니다.
운영 배포 시에는 nginx 등에서 직접 `/admin/*`을 API 서버로 프록시하세요.

---

## 빌드 결과

```
admin/dist/
├── index.html                   0.44 kB
├── assets/index.css            14.73 kB (gzip 3.37 kB)
└── assets/index.js            255.84 kB (gzip 74.92 kB)
```

---

## 레이아웃

```
┌─────────────────────────────────────────────┐
│  🎮 Admin · idle-game-server       로그아웃  │
├─────────┬───────────────────────────────────┤
│         │                                   │
│ 📊 대시 │                                   │
│ 🔍 사용 │          메인 콘텐츠              │
│ 🚫 제재 │                                   │
│ 💰 지급 │                                   │
│ 🔒 보안 │                                   │
│ 📋 로그 │                                   │
│         │                                   │
├─────────┴───────────────────────────────────┤
│  ⏻ 로그아웃                                │
└─────────────────────────────────────────────┘
```
