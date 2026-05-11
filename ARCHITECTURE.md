# 산업안전 AI 솔루션 — 서버/앱 분리 설계안

## 1. 프로젝트 개요

### 현재 상태
- Capacitor 기반 Android 단일 앱
- Claude claude-sonnet-4-5 API를 활용한 현장 안전점검 (이미지 분석)
- BM25 로컬 검색으로 관련 법령 조항 매칭
- 데이터 저장: localStorage (기기 단독)

### 목표 상태
- **백엔드 서버** + **모바일 앱** + **웹 관리 포털** 3계층 분리
- 작업절차서 작성/관리/승인 워크플로우
- 안전점검 시 해당 작업절차서 자동 연동 → AI 준수 여부 분석
- 점검 이력 중앙 저장 및 통계/보고서 관리

---

## 2. 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────────┐
│                         외부 서비스                           │
│              Anthropic Claude API (claude-sonnet-4-5)         │
└─────────────────────────┬────────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼────────────────────────────────────┐
│                     Backend Server                            │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │  REST API   │  │  AI Proxy   │  │    File Storage      │ │
│  │ (Express /  │  │  (Claude    │  │  (이미지 / PDF /      │ │
│  │  FastAPI)   │  │   API 중계) │  │   작업절차서 파일)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬───────────┘ │
│         │                │                     │             │
│  ┌──────▼──────────────────────────────────────▼───────────┐ │
│  │                    Database (PostgreSQL)                 │ │
│  │  users / roles / procedures / inspections / reports     │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────┬───────────────────────────────┬───────────────────┘
           │ REST API / WebSocket           │ REST API
    ┌──────▼──────────┐            ┌────────▼────────┐
    │   모바일 앱      │            │   웹 관리 포털   │
    │  (Capacitor)    │            │  (React / Vue)  │
    │                 │            │                 │
    │ • 작업절차서     │            │ • 절차서 승인    │
    │   작성/조회      │            │ • 점검현황 조회  │
    │ • 현장 안전점검  │            │ • 통계/대시보드  │
    │ • 보고서 확인    │            │ • 사용자 관리    │
    └─────────────────┘            └─────────────────┘
```

---

## 3. 사용자 역할 (Role)

| 역할 | 설명 | 주요 기능 |
|------|------|-----------|
| `worker` | 현장 작업자 | 작업절차서 작성, 안전점검 수행, 내 보고서 조회 |
| `safety_manager` | 안전관리자 | 절차서 검토/승인, 전체 점검결과 확인, 보고서 서명 |
| `admin` | 시스템 관리자 | 사용자 관리, 현장/부서 관리, 전체 통계 |

---

## 4. 기술 스택

| 레이어 | 기술 | 버전 | 비고 |
|--------|------|------|------|
| **모바일 앱** | Capacitor + HTML/CSS/JS | v6 | 기존 앱 API 연동으로 전환 |
| **웹 포털** | React + TypeScript | 18+ | 관리자/안전관리자 화면 |
| **백엔드 API** | Node.js + Express | 20+ | REST API |
| **AI 중계** | Express 미들웨어 | — | Claude API Key 서버측 보관 |
| **데이터베이스** | PostgreSQL | 15+ | 관계형 데이터 |
| **ORM** | Prisma | 5+ | DB 스키마 관리 |
| **파일 저장** | 로컬 디스크 or AWS S3 | — | 이미지, PDF, 절차서 파일 |
| **인증** | JWT (Access + Refresh Token) | — | 역할기반 접근제어 |
| **컨테이너** | Docker + Docker Compose | — | 개발/운영 환경 통일 |
| **음성 입력 (STT)** | Web Speech API (브라우저 내장) | — | 무료, 한국어 지원, Android WebView 동작 |
| **문서 파싱** | JSZip (브라우저) | 3+ | hwpx/docx ZIP 구조 파싱 |
| **로컬 문서 저장** | IndexedDB | — | 작업절차서 기기 저장 (서버 전환 전 단계) |

---

## 5. 디렉터리 구조

```
safety-ai-platform/
├── backend/                        ← Node.js API 서버
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js             ← 로그인/로그아웃/토큰 갱신
│   │   │   ├── users.js            ← 사용자 관리
│   │   │   ├── procedures.js       ← 작업절차서 CRUD
│   │   │   ├── inspections.js      ← 안전점검 CRUD
│   │   │   ├── reports.js          ← 보고서 생성/조회
│   │   │   └── ai.js               ← Claude API 프록시
│   │   ├── middleware/
│   │   │   ├── auth.js             ← JWT 검증
│   │   │   └── roleCheck.js        ← 역할 권한 확인
│   │   ├── services/
│   │   │   ├── claudeService.js    ← Claude API 호출 로직
│   │   │   ├── bm25Service.js      ← 법령/절차서 BM25 검색
│   │   │   └── pdfService.js       ← PDF 보고서 생성
│   │   └── app.js
│   ├── prisma/
│   │   └── schema.prisma           ← DB 스키마 정의
│   ├── uploads/                    ← 업로드 이미지/파일 저장
│   ├── .env
│   └── package.json
│
├── web-portal/                     ← React 웹 관리 포털
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx       ← 현황 대시보드
│   │   │   ├── Procedures.tsx      ← 절차서 목록/승인
│   │   │   ├── Inspections.tsx     ← 점검 현황
│   │   │   ├── Reports.tsx         ← 보고서 관리
│   │   │   └── Users.tsx           ← 사용자 관리
│   │   ├── components/
│   │   └── api/                    ← Backend API 호출 함수
│   └── package.json
│
├── mobile-app/                     ← 기존 Capacitor 앱 (수정)
│   ├── www/
│   │   ├── js/
│   │   │   ├── api.js              ← (신규) Backend API 클라이언트
│   │   │   ├── auth.js             ← (신규) 로그인 화면 로직
│   │   │   ├── procedure.js        ← (신규) 작업절차서 작성/조회
│   │   │   ├── inspection.js       ← (수정) 절차서 연동 추가
│   │   │   ├── bridge.js           ← (수정) AI 호출 → 서버 프록시로 전환
│   │   │   └── ...
│   │   └── index.html
│   └── android/
│
└── docker-compose.yml              ← 전체 서비스 실행
```

---

## 6. 데이터베이스 스키마 (Prisma)

```prisma
// 사용자
model User {
  id           Int      @id @default(autoincrement())
  email        String   @unique
  passwordHash String
  name         String
  role         Role     @default(worker)
  department   String?
  createdAt    DateTime @default(now())

  procedures   Procedure[]
  inspections  Inspection[]
}

enum Role {
  worker
  safety_manager
  admin
}

// 작업절차서
model Procedure {
  id          Int               @id @default(autoincrement())
  title       String            // 예: "고소작업 안전작업절차서"
  category    String            // general / construction / manufacturing / chemical / electric / fall
  version     String            @default("v1.0")
  status      ProcedureStatus   @default(draft)
  content     Json              // 절차 단계, 체크리스트 JSON
  fullText    String            // 검색용 전체 텍스트
  keywords    String[]          // BM25 검색용 키워드
  createdBy   Int
  approvedBy  Int?
  approvedAt  DateTime?
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  author      User              @relation(fields: [createdBy], references: [id])
  inspections Inspection[]
}

enum ProcedureStatus {
  draft         // 작성 중
  pending       // 승인 요청
  approved      // 승인 완료
  rejected      // 반려
  archived      // 폐기
}

// 안전점검
model Inspection {
  id            Int               @id @default(autoincrement())
  category      String
  note          String?
  imageUrl      String?           // 업로드된 이미지 경로
  procedureId   Int?              // 연결된 작업절차서 (nullable)
  resultText    String            // AI 분석 결과 (마크다운)
  lawCitation   String?           // 관련 법령 해설
  compliance    Json?             // 절차서 준수 여부 항목별 결과
  riskLevel     String            // 위험 / 주의 / 양호
  inspectedBy   Int
  createdAt     DateTime          @default(now())

  inspector     User              @relation(fields: [inspectedBy], references: [id])
  procedure     Procedure?        @relation(fields: [procedureId], references: [id])
  report        Report?
}

// 보고서
model Report {
  id           Int      @id @default(autoincrement())
  inspectionId Int      @unique
  pdfUrl       String?  // 생성된 PDF 파일 경로
  signedBy     Int?     // 서명한 안전관리자
  signedAt     DateTime?
  createdAt    DateTime @default(now())

  inspection   Inspection @relation(fields: [inspectionId], references: [id])
}
```

---

## 7. API 엔드포인트 설계

### 인증
```
POST   /api/auth/login          로그인 (JWT 발급)
POST   /api/auth/refresh        액세스 토큰 갱신
POST   /api/auth/logout         로그아웃
```

### 작업절차서
```
GET    /api/procedures          목록 조회 (카테고리/상태 필터)
POST   /api/procedures          새 절차서 작성 (worker)
GET    /api/procedures/:id      상세 조회
PUT    /api/procedures/:id      수정 (작성자 본인 + draft 상태만)
PATCH  /api/procedures/:id/submit    승인 요청 (worker)
PATCH  /api/procedures/:id/approve   승인 (safety_manager)
PATCH  /api/procedures/:id/reject    반려 (safety_manager)
GET    /api/procedures/search   BM25 검색 (카테고리 + 키워드)
```

### 안전점검
```
POST   /api/inspections         점검 시작 + 이미지 업로드
GET    /api/inspections         목록 조회
GET    /api/inspections/:id     상세 조회
```

### AI 프록시 (Claude API Key 서버측 보관)
```
POST   /api/ai/analyze          이미지 + 절차서 → Claude 분석 (SSE 스트리밍)
POST   /api/ai/law-explain      법령 조항 해설 생성 (SSE 스트리밍)
```

### 보고서
```
GET    /api/reports             목록 조회
GET    /api/reports/:id         상세 조회
GET    /api/reports/:id/pdf     PDF 다운로드
PATCH  /api/reports/:id/sign    안전관리자 서명
```

### 사용자 관리 (admin)
```
GET    /api/users               사용자 목록
POST   /api/users               사용자 생성
PATCH  /api/users/:id/role      역할 변경
DELETE /api/users/:id           사용자 삭제
```

---

## 8. 핵심 변경 — AI 분석 프롬프트 (절차서 연동)

```javascript
// backend/src/services/claudeService.js

function buildInspectionPrompt({ category, note, procedureContent }) {

  const basePrompt = `당신은 산업안전보건 전문가입니다.
업로드된 현장 이미지를 분석하여 안전점검 보고서를 작성해주세요.

점검 분야: ${category}
${note ? `현장 메모: ${note}` : ''}`;

  // 작업절차서가 연결된 경우 — 준수 여부 평가 추가
  const procedureSection = procedureContent ? `

[연결된 작업절차서]
${JSON.stringify(procedureContent, null, 2)}

위 작업절차서의 각 체크리스트 항목이 이미지에서
준수되고 있는지 평가하여 아래 형식에 포함하세요.` : '';

  const outputFormat = `
---
출력 형식(마크다운):

## 🔍 종합 위험도: [🔴 위험 / 🟡 주의 / 🟢 양호]

## ⚠️ 발견된 위험 요소
각 위험 요소를 번호와 함께 구체적으로 나열하세요.

## 🚨 즉각 조치 사항
지금 당장 취해야 할 조치를 우선순위 순으로 작성하세요.

## 📋 개선 권고사항
중장기적으로 개선해야 할 사항을 작성하세요.
${procedureContent ? `
## ✅ 작업절차 준수 여부
절차서: ${procedureContent.title} (${procedureContent.version})

| 체크리스트 항목 | 준수 여부 | 비고 |
|----------------|-----------|------|
(각 항목을 ✅ 준수 / ❌ 미준수 / ⚠️ 확인불가 로 평가)

종합 준수율: X / Y 항목` : ''}
---
위 섹션만 작성하세요. 추가 섹션은 작성하지 마세요.`;

  return basePrompt + procedureSection + outputFormat;
}
```

---

## 9. 모바일 앱 수정 포인트

### 9-1. 추가할 화면
```
로그인 화면           → JWT 토큰 저장 (localStorage → 서버 인증)
작업절차서 목록       → 서버에서 조회 (카테고리별 필터)
작업절차서 작성       → 서버에 저장 + 승인 요청
작업절차서 상세       → 체크리스트 확인
```

### 9-2. 안전점검 화면 변경
```
기존: 이미지 업로드 → Claude 직접 호출
변경: 이미지 업로드 → 서버 API 호출
              ↓
      관련 작업절차서 자동 매칭 (BM25)
              ↓
      작업절차서 선택 UI (자동 매칭 or 직접 선택)
              ↓
      서버 AI 프록시 → Claude 분석
```

### 9-3. bridge.js 변경 방향
```javascript
// 기존: 브라우저에서 Claude API 직접 호출
fetch('https://api.anthropic.com/v1/messages', { ... })

// 변경: 백엔드 서버를 통해 호출 (API Key 서버측 보관)
fetch('https://your-server.com/api/ai/analyze', {
  headers: { 'Authorization': `Bearer ${jwtToken}` },
  body: JSON.stringify({ imageBase64, category, procedureId })
})
```

---

## 10. 웹 관리 포털 주요 화면

### 대시보드
- 이번 달 점검 건수 / 위험 건수 / 준수율 통계
- 최근 점검 목록 (위험도별 색상 표시)
- 승인 대기 중인 작업절차서 건수

### 작업절차서 관리
- 전체 절차서 목록 (상태별 필터: 작성중/승인대기/승인/반려)
- 절차서 상세 보기 / 승인 / 반려 처리
- 절차서 버전 이력

### 점검 현황
- 현장별 / 작업자별 / 기간별 점검 현황
- 점검 결과 상세 보기
- PDF 보고서 다운로드 / 안전관리자 서명

### 통계
- 위험도별 점검 추이 (차트)
- 작업절차 준수율 추이
- 위험 요소 유형별 빈도

---

## 11. 보고서 추가 내용 (절차서 연동 후)

```
📄 안전 점검 보고서
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
점검 일시: 2026-05-08 14:30
점검 분야: 건설현장 (비계, 고소작업)
점검자: 홍길동 (worker)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[종합 위험도] 🔴 위험

[발견된 위험 요소]
1. 비계 안전난간 미설치 (3층 구간)
2. 안전대 미착용 작업자 2명 확인
...

[즉각 조치 사항] ...
[개선 권고사항] ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[작업절차 준수 확인]  ← 신규 추가
적용 절차서: 고소작업 안전작업절차서 v2.1
작성자: 김작업 / 승인: 이관리 (2026-05-01)

항목             결과      비고
────────────────────────────────
안전모 착용       ✅ 준수
안전대 체결       ❌ 미준수  작업자 2명 미착용 확인
안전난간 설치      ❌ 미준수  3층 구간 미설치
추락방지망        ⚠️ 확인불가

종합 준수율: 1 / 4 (25%)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[관련 법령]
산업안전보건법 시행령 제42조 ...
중대재해처벌법 시행령 제4조 ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
안전관리자 확인: 이관리  [서명]  2026-05-08
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 12. 음성 입력 (STT) 기능 설계

### 12-1. 개요

현장 작업자가 장갑 착용, 소음 등 열악한 환경에서 텍스트 입력 대신
**말로 작업 내용을 설명**하면 자동으로 텍스트로 변환하는 기능.

### 12-2. 기술 방식

```
Web Speech API (브라우저 내장)
  - 비용: 무료 (Android 내장 Google STT 엔진 사용)
  - 언어: ko-KR (한국어)
  - 인터넷 연결 필요
  - Android WebView(Chrome 기반)에서 동작 확인
  - PC Chrome/Edge에서도 동작 (Firefox 미지원 → 버튼 숨김 처리)
```

### 12-3. MVP 적용 범위 — 안전점검 추가설명 입력

```
현재
┌─────────────────────────────────┐
│ [추가 설명 (선택)]               │
│ ┌─────────────────────────────┐ │
│ │ 점검 위치, 특이사항 등...    │ │  ← 텍스트만 입력 가능
│ └─────────────────────────────┘ │
└─────────────────────────────────┘

변경 후
┌─────────────────────────────────┐
│ [추가 설명 (선택)]               │
│ ┌───────────────────────────┬─┐ │
│ │ 점검 위치, 특이사항 등... │🎤│ │  ← 마이크 버튼 추가
│ └───────────────────────────┴─┘ │
└─────────────────────────────────┘
```

### 12-4. 상태별 UX 흐름

```
① 기본 상태
   [textarea: 직접 입력 가능] [🎤]

② 🎤 탭 → 녹음 시작
   [🔴 듣는 중... 실시간 텍스트 표시] [⏹]
   마이크 권한 최초 요청 (Android 권한 팝업)

③ 말이 끊기면 자동 완료 or ⏹ 탭
   [인식된 텍스트가 textarea에 삽입]
   사용자가 직접 수정 가능

④ 점검하기 버튼 활성화 → 이후 기존 플로우 동일
```

### 12-5. 예외 처리

| 상황 | 처리 방법 |
|------|-----------|
| 마이크 권한 없음 | "마이크 권한을 허용해 주세요" 토스트 안내 |
| 음성 인식 실패 (소음) | "다시 시도해 주세요" 표시, textarea 직접 입력 fallback |
| 브라우저 미지원 | 🎤 버튼 자동 숨김, 기존 텍스트 입력만 표시 |
| 인식 중 화면 전환 | 녹음 자동 중지 |

### 12-6. 변경 파일 범위

| 파일 | 변경 내용 |
|------|-----------|
| `www/index.html` | textarea 옆 🎤 버튼 추가 |
| `www/js/inspection.js` | Web Speech API 바인딩 로직 추가 (~30줄) |
| `www/css/style.css` | 마이크 버튼 스타일, 녹음 중 애니메이션 |
| `android/AndroidManifest.xml` | RECORD_AUDIO 권한 추가 |

### 12-7. 향후 확장 — 작업절차서 자동 매칭 연동 (Phase 3)

```
현재 (1단계 MVP)
음성 입력 → 텍스트 → textarea 삽입

향후 (2단계)
음성 입력 → 텍스트 → textarea 삽입
                          ↓
                 BM25 자동 검색 트리거
                          ↓
                 관련 작업절차서 후보 표시
                          ↓
                 사용자 선택 → 점검 연동
```

textarea에 텍스트가 들어오는 시점에 BM25를 트리거하면
**추가 구조 변경 없이 자연스럽게 연동** 가능.

---

## 13. 작업절차서 업로드 기능 설계

### 13-1. 개요

현장 관리자가 작업 시작 전 **작업계획서(hwpx/PDF/이미지)를 업로드**하면
앱이 내용을 추출·저장하고, 안전점검 시 STT 입력과 BM25로 자동 매칭.

### 13-2. 지원 문서 형식

| 형식 | 파싱 방법 | 비고 |
|------|-----------|------|
| **hwpx** (한글) | JSZip → section0.xml → `<hp:t>` 태그 추출 | 고용노동부 표준서식 |
| **PDF** | Claude Vision으로 텍스트 추출 | API 1회 호출 |
| **이미지** (종이 촬영) | Claude Vision OCR | API 1회 호출 |
| **txt / 직접 입력** | 그대로 저장 | 추가 처리 없음 |

### 13-3. 업로드 플로우

```
[작업절차서] 메뉴 진입
        ↓
[+ 새 절차서 등록] 탭
        ↓
파일 선택 (hwpx / PDF / 이미지 / 직접입력)
        ↓
┌────────────────────────────────────┐
│  hwpx          PDF / 이미지        │
│  JSZip 파싱    Claude Vision 추출  │
│  (로컬, 무료)  (API 1회 호출)      │
└───────────────┬────────────────────┘
                ↓
        텍스트 추출 완료
                ↓
┌────────────────────────────────────┐
│  절차서 정보 확인                  │
│  제목: [자동추출 / 수정 가능]      │
│  분야: [자동분류 / 선택 가능]      │
│  키워드: [자동추출]                │
│                                    │
│  내용 미리보기 (스크롤)            │
│  ─────────────────────────────     │
│  1. 작업개요: 지게차 철근 하역...  │
│  6. 재해유형별 안전조치: ...       │
│                                    │
│  [저장]        [취소]              │
└────────────────────────────────────┘
        ↓ 저장
IndexedDB 저장 + BM25 인덱싱
```

### 13-4. IndexedDB 저장 구조

```javascript
{
  id:           "proc_1746700000000",
  title:        "지게차 작업계획서",
  category:     "forklift",           // BM25 필터링용
  keywords:     ["지게차", "하역", "철근", "부딪힘", "유도자"],
  fullText:     "1. 작업개요: ...\n6. 재해유형별 안전조치: ...",
  fileName:     "지게차_작업계획서.hwpx",
  registeredAt: "2026-05-08T09:00:00",
  registeredBy: "홍관리자"
}
```

### 13-5. 안전점검 연동 — 매칭 흐름

```
STT 음성 입력
"지게차로 3층 철근 하역 작업입니다"
        ↓
텍스트 추출: ["지게차", "철근", "하역", "작업"]
        ↓
IndexedDB 전체 절차서 BM25 검색
        ↓
┌────────────────────────────────────┐
│  📄 관련 절차서 발견               │
│                                    │
│  1위 ✅ 지게차 작업계획서   94점  │
│  2위    크레인 작업계획서   21점  │
│                                    │
│  [이걸로 점검 시작] [다른 거 선택] │
│  [절차서 없이 점검]                │
└────────────────────────────────────┘
        ↓ 선택
이미지 + 절차서 전문 → Claude 분석
        ↓
기존 4개 섹션 + 작업절차 준수 여부 섹션 출력
```

### 13-6. 절차서 목록 화면 구성

```
┌────────────────────────────────────┐
│  📋 작업절차서                      │
│                          [+ 등록]  │
│ ─────────────────────────────────  │
│  📄 지게차 작업계획서               │
│     2026-05-08 · 홍관리자           │
│     키워드: 지게차, 하역, 철근      │
│                         [삭제]     │
│ ─────────────────────────────────  │
│  📄 롤러 작업계획서                 │
│     2026-05-07 · 이관리자           │
│     키워드: 롤러, 다짐, 후진        │
│                         [삭제]     │
└────────────────────────────────────┘
```

### 13-7. 서버 전환 시 변경 포인트

```
현재 (단일 앱)          →   서버 전환 후
IndexedDB 저장          →   PostgreSQL (Procedure 테이블)
JSZip 브라우저 파싱     →   서버에서 파싱 후 DB 저장
BM25 클라이언트 실행    →   서버 BM25 서비스로 이동
기기 내 절차서만 조회   →   전체 현장 절차서 공유 가능
```

---

## 14. 구현 단계 (로드맵)

### Phase 0 — 현재 앱 기능 고도화 (단일 앱, 서버 없음)

> 서버 구축 전 현재 앱에서 먼저 검증하는 단계

- [ ] **STT 음성 입력** — 추가설명 textarea에 마이크 버튼 추가 (§12 참조)
  - Web Speech API 연동
  - Android RECORD_AUDIO 권한 추가
  - PC/Android 동시 테스트
- [ ] **작업절차서 업로드** — hwpx/PDF/이미지 파싱 후 IndexedDB 저장 (§13 참조)
  - JSZip으로 hwpx 파싱
  - 절차서 목록/등록/삭제 화면
- [ ] **STT → BM25 → 절차서 자동 매칭**
  - 음성 입력 텍스트로 절차서 검색
  - 매칭 결과 표시 및 사용자 선택 UI
- [ ] **안전점검 + 절차서 연동 분석**
  - Claude 프롬프트에 절차서 내용 포함
  - 준수 여부 섹션 결과 출력
  - PDF 보고서에 준수율 추가

### Phase 1 — 백엔드 기반 구축 (1~2주)
- [ ] Node.js + Express 프로젝트 초기화
- [ ] PostgreSQL + Prisma 스키마 설정
- [ ] JWT 인증 (로그인 / 토큰 갱신)
- [ ] Claude API 프록시 엔드포인트 (SSE 스트리밍)
- [ ] Docker Compose 구성

### Phase 2 — 작업절차서 기능 서버 이전 (1~2주)
- [ ] 작업절차서 CRUD API
- [ ] 승인 워크플로우 API (submit / approve / reject)
- [ ] 서버 BM25 절차서 검색 서비스 (Phase 0 클라이언트 로직 이전)
- [ ] 파일 업로드 (이미지 / hwpx / PDF)

### Phase 3 — 모바일 앱 서버 연동 (1~2주)
- [ ] 로그인 화면 추가
- [ ] bridge.js → 서버 API 호출로 전환
- [ ] IndexedDB → 서버 DB로 절차서 저장 이전
- [ ] 안전점검 화면 — 서버 절차서 연동

### Phase 4 — 웹 관리 포털 (2~3주)
- [ ] React 프로젝트 초기화
- [ ] 대시보드 / 절차서 승인 / 점검 현황 화면
- [ ] 안전관리자 보고서 서명 기능
- [ ] 통계 차트

### Phase 5 — 고도화
- [ ] 벡터 임베딩 검색 (BM25 → Semantic Search)
- [ ] 점검 이력 통계/분석
- [ ] 알림 기능 (승인 요청, 위험 점검 결과)
- [ ] 오프라인 모드 (모바일 앱)
- [ ] Whisper API 전환 (건설 전문용어 인식률 향상 필요 시)

---

## 13. 배포 구성 (Docker Compose)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: safety_ai
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://admin:${DB_PASSWORD}@postgres:5432/safety_ai
      JWT_SECRET: ${JWT_SECRET}
      CLAUDE_API_KEY: ${CLAUDE_API_KEY}
      UPLOAD_DIR: /app/uploads
    volumes:
      - uploads_data:/app/uploads
    ports:
      - "4000:4000"
    depends_on:
      - postgres

  web-portal:
    build: ./web-portal
    environment:
      REACT_APP_API_URL: http://localhost:4000
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  postgres_data:
  uploads_data:
```

---

## 14. 환경 변수 (.env)

```env
# Database
DB_PASSWORD=your_db_password

# JWT
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d

# Claude API
CLAUDE_API_KEY=sk-ant-api03-...
CLAUDE_MODEL=claude-sonnet-4-5

# Server
PORT=4000
UPLOAD_DIR=./uploads
MAX_FILE_SIZE_MB=10

# Client
WEB_PORTAL_URL=http://localhost:3000
MOBILE_APP_URL=capacitor://localhost
```

---

## 15. 현재 앱에서 유지할 것 / 변경할 것

| 항목 | 현재 | 변경 후 |
|------|------|---------|
| Claude API 호출 | 앱에서 직접 (bridge.js) | 서버 프록시 경유 |
| API Key 위치 | 앱 내 EncryptedSharedPreferences | 서버 .env |
| 법령 BM25 검색 | 앱 내 law-chunks.json | 서버 서비스로 이동 |
| 점검 결과 저장 | localStorage | 서버 DB |
| 인증 | 없음 | JWT 로그인 |
| 작업절차서 | 없음 | 서버 DB + 앱 UI 신규 |
| 보고서 PDF | Android 네이티브 생성 | 서버에서 생성 후 다운로드 |
| 법령 데이터 | www/data/law-chunks.json | 서버 데이터 or 유지 |
