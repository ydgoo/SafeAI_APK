# 🛡️ SafeAI — 산업안전 AI 솔루션

> Anthropic Claude API 기반 현장 안전점검 Android 앱

[![Android](https://img.shields.io/badge/Android-APK-3DDC84?logo=android&logoColor=white)](https://github.com/ydgoo/SafeAI_APK)
[![Capacitor](https://img.shields.io/badge/Capacitor-v6-119EFF?logo=capacitor&logoColor=white)](https://capacitorjs.com/)
[![Claude](https://img.shields.io/badge/Claude-claude--sonnet--4--5-D97706?logo=anthropic&logoColor=white)](https://anthropic.com/)

---

## 📱 주요 기능

### 1. AI 안전점검
- 현장 사진 또는 영상(1분 미만) 업로드
- Claude AI가 위험 요소를 자동 분석
- **종합 위험도** (🔴 위험 / 🟡 주의 / 🟢 양호) 판정
- 발견된 위험 요소 / 즉각 조치 사항 / 개선 권고사항 출력
- 점검 분야별 특화 분석 (건설현장 / 제조업 / 화학·위험물 / 전기·설비 / 추락·낙하)

### 2. 관련 법령 자동 검색
- BM25 알고리즘으로 점검 결과와 관련된 법령 조항 자동 매칭
- **산업안전보건법 시행령** 146개 조항
- **중대재해처벌법 시행령** 14개 조항
- Claude AI가 해당 조항이 왜 적용되는지 실무적으로 해설

### 3. 법령 조회
- 산업안전보건법 / 중대재해처벌법 전문 카드 뷰어
- 조항명·내용 실시간 검색
- AI 질의응답 (법령 관련 자유 질문)

### 4. 보고서 생성
- 점검 결과를 HTML 보고서로 미리보기
- **Android**: 네이티브 PDF 생성 → 다운로드 폴더 자동 저장
- **PC 브라우저**: 브라우저 인쇄 기능으로 PDF 저장

---

## 🖥️ 화면 구성

```
홈 화면
├── 안전점검        → 이미지/영상 업로드 → AI 분석 → 보고서 생성
├── 산업안전보건법  → 법령 전문 조회 + AI 질의
└── 중대재해처벌법  → 법령 전문 조회 + AI 질의
```

---

## 🛠️ 기술 스택

| 레이어 | 기술 |
|--------|------|
| UI | HTML5 + CSS3 + Vanilla JS |
| 앱 패키징 | Capacitor v6 (Android WebView) |
| AI 추론 | Anthropic Claude claude-sonnet-4-5 API (스트리밍 SSE) |
| 법령 검색 | BM25 로컬 검색 (law-chunks.json) |
| Native 브릿지 | Capacitor Custom Plugin (Kotlin) |
| API Key 저장 | Android EncryptedSharedPreferences |
| HTTP 통신 | OkHttp (Kotlin, SSE 스트리밍) |
| PDF 생성 | Android PdfDocument (네이티브) |
| 마크다운 렌더링 | marked.js |

---

## 📁 프로젝트 구조

```
SafeAI_APK/
├── www/                          # 웹 UI (Capacitor webroot)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── app.js                # 앱 초기화, 화면 전환
│   │   ├── bridge.js             # Claude API 브릿지 (⚠️ API Key 포함, git 제외)
│   │   ├── inspection.js         # 안전점검 로직
│   │   ├── law.js                # 산업안전보건법 화면
│   │   ├── serious-accident.js   # 중대재해처벌법 화면
│   │   ├── law-retriever.js      # BM25 법령 검색
│   │   ├── camera.js             # 카메라/이미지 처리
│   │   └── api-key-ui.js         # API Key 입력 화면
│   ├── data/
│   │   └── law-chunks.json       # 법령 조항 데이터 (160개)
│   └── lib/
│       └── marked.min.js
├── android/
│   └── app/src/main/java/com/gemma4/visionchat/
│       ├── ClaudePlugin.kt       # Capacitor 플러그인 (⚠️ API Key 포함, git 제외)
│       ├── AnthropicClient.kt    # Claude API 통신 + SSE 파싱
│       └── MainActivity.java
├── law/                          # 법령 원본 파일 (PDF/TXT)
├── scripts/                      # 법령 데이터 빌드 스크립트
├── ARCHITECTURE.md               # 서버/앱 분리 확장 설계안
└── CLAUDE.md                     # 프로젝트 설계 문서
```

---

## 🚀 시작하기

### 사전 요구사항

- Node.js 18+
- Android Studio (Kotlin 지원)
- Anthropic API Key ([console.anthropic.com](https://console.anthropic.com) 에서 발급)

### PC 브라우저 실행 (빠른 테스트)

```bash
# 저장소 클론
git clone https://github.com/ydgoo/SafeAI_APK.git
cd SafeAI_APK

# 로컬 웹서버 실행
python -m http.server 3333 --directory www

# 브라우저에서 접속
# http://localhost:3333
```

> API Key 입력 화면에서 `sk-ant-api03-...` 형식의 키를 입력하면 바로 사용 가능합니다.

### Android APK 빌드

**1. API Key 설정**

`www/js/bridge.js` 파일을 생성하여 API Key를 입력합니다.
(이 파일은 `.gitignore`에 등록되어 있어 직접 생성해야 합니다.)

```javascript
// www/js/bridge.js 참고 — bridge.js.example 참조
const _pcBridge = {
  getApiKey() {
    return localStorage.getItem('claude_api_key')
        || 'YOUR_ANTHROPIC_API_KEY_HERE';
  },
  // ...
};
```

`android/app/src/main/java/com/gemma4/visionchat/ClaudePlugin.kt` 도 동일하게 설정합니다.

```kotlin
const val DEFAULT_KEY = "YOUR_ANTHROPIC_API_KEY_HERE"
```

**2. 빌드**

```bash
# 의존성 설치
npm install

# 웹 파일 Android로 동기화
npx cap sync android

# APK 빌드 (Android Studio JBR 사용)
cd android
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

APK 경로: `android/app/build/outputs/apk/debug/app-debug.apk`

---

## ⚙️ 설정

| 항목 | 설명 |
|------|------|
| 응답 언어 | 한국어 / English |
| 최대 응답 길이 | 512 ~ 4096 tokens |
| API Key 변경 | 설정 화면에서 언제든지 변경 가능 |

---

## 🔒 보안

- API Key는 Android `EncryptedSharedPreferences` (AES256-GCM)에 암호화 저장
- `bridge.js`, `ClaudePlugin.kt` 파일은 `.gitignore`로 git 추적 제외
- 모든 API 통신은 HTTPS 사용

---

## 🗺️ 향후 계획

서버/앱 분리를 통한 플랫폼 확장 계획이 있습니다. 자세한 내용은 [`ARCHITECTURE.md`](./ARCHITECTURE.md)를 참조하세요.

- [ ] 백엔드 서버 (Node.js + PostgreSQL)
- [ ] 작업절차서 작성/관리/승인 워크플로우
- [ ] 안전점검 시 작업절차서 준수 여부 AI 분석
- [ ] 웹 관리 포털 (안전관리자용 대시보드)
- [ ] 점검 이력 통계 및 분석

---

## 📄 라이선스

본 프로젝트는 사내 업무용으로 개발되었습니다.

---

## 🙋 문의

- Email: ydgoo@coretrust.com
