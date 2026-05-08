# Claude Vision Chat — 설계 문서

## 프로젝트 개요

Anthropic **Claude claude-sonnet-4-5 API**를 활용하는 멀티모달 채팅 Android 앱.  
HTML/CSS/JS UI를 Capacitor로 APK 패키징하고, Anthropic Messages API를 통해 텍스트 및 이미지 분석.  
온디바이스 모델 없이 인터넷 연결만으로 동작 (완전 클라우드 기반).

---

## 대상 기기 — Galaxy Z Flip 6

| 항목 | 스펙 |
|------|------|
| SoC | Snapdragon 8 Gen 3 |
| RAM | 12GB LPDDR5X |
| 저장소 | 256GB UFS 4.0 |
| OS | Android 14+ |
| 화면 | 6.7" 2640×1080 (세로) |

**응답 속도**: Claude API 네트워크 레이턴시 + 스트리밍 (첫 토큰 ~1초 내외)

---

## 대화 모드 — 핵심 동작 정의

앱은 하나의 채팅창에서 두 가지 대화 모드를 자연스럽게 전환한다.

### 모드 1 — 일반 텍스트 대화

- 이미지 없이 텍스트만 입력하면 Claude와 일반 대화
- 이전 대화 맥락을 유지하며 연속 질의 가능
- 예시:
  ```
  사용자: 파이썬에서 리스트 컴프리헨션이 뭐야?
  Claude: 리스트 컴프리헨션은 ...
  사용자: 그럼 딕셔너리는?       ← 맥락 유지
  Claude: 딕셔너리 컴프리헨션은 ...
  ```

### 모드 2 — 이미지 + 텍스트 대화

- 카메라 촬영 또는 이미지 파일 선택 후 텍스트 질문 전송
- 이미지는 해당 메시지 버블 상단에 썸네일로 표시
- 이미지만 첨부하고 전송하면 "이 이미지를 분석해줘" 기본 프롬프트 자동 적용
- 이미지 전송 후 후속 질문은 텍스트만으로 가능 (직전 이미지 맥락 유지)
- 예시:
  ```
  사용자: [사진 첨부] 이 음식이 뭐야?
  Claude: 이 음식은 비빔밥입니다 ...
  사용자: 칼로리는 얼마나 돼?    ← 이미지 없이 후속 질문
  Claude: 비빔밥의 평균 칼로리는 ...
  ```

### 모드 전환 규칙

| 상황 | 동작 |
|------|------|
| 텍스트만 입력 | 텍스트 전용 API 호출 |
| 이미지 + 텍스트 입력 | 멀티모달 API 호출 (이미지 + 텍스트) |
| 이미지만 첨부 후 전송 | 기본 프롬프트 "이 이미지를 분석해줘" 자동 삽입 |
| 이미지 첨부 후 텍스트 수정 | 수정된 텍스트로 전송 |
| 새 이미지 첨부 | 이전 첨부 이미지 교체 (한 번에 이미지 1장) |

### 입력 바 상태 표시

- 이미지 첨부된 경우: 입력 바 위에 썸네일 미리보기 + ✕ 제거 버튼
- 이미지 없는 경우: 일반 텍스트 입력 상태 (추가 UI 없음)

---

## 기술 스택

| 레이어 | 기술 | 비고 |
|--------|------|------|
| UI | HTML5 + CSS3 + Vanilla JS | 프레임워크 없음 |
| APK 패키징 | Capacitor v6 | WebView 래퍼 |
| JS ↔ Native 브릿지 | Capacitor Custom Plugin (Kotlin) | API Key 보안 저장, HTTPS 요청 |
| AI 추론 | Anthropic Claude claude-sonnet-4-5 API | 클라우드 기반, 스트리밍 SSE |
| Vision | Claude claude-sonnet-4-5 내장 (별도 모델 불필요) | base64 이미지 직접 전달 |
| 카메라/파일 | Capacitor Camera Plugin | 갤러리/카메라 접근 |
| API 통신 | OkHttp (Kotlin) | HTTPS + SSE 스트리밍 |
| API Key 저장 | Android EncryptedSharedPreferences | 앱 내 안전 저장 |
| 마크다운 렌더링 | marked.js (로컬 번들) | AI 응답 렌더링 |
| 빌드 | Node.js + Android Studio (Gradle) | NDK 불필요 |

---

## 아키텍처

```
┌──────────────────────────────────────────────────────┐
│                    Android APK                       │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │          Capacitor WebView (UI Layer)        │    │
│  │  index.html / style.css / app.js             │    │
│  │  채팅 UI, 이미지 미리보기, 마크다운 렌더링      │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │ Capacitor Plugin Bridge            │
│  ┌──────────────▼──────────────────────────────┐    │
│  │        ClaudePlugin.kt (Kotlin)              │    │
│  │  - getApiKeyStatus()  API Key 등록 여부 확인  │    │
│  │  - saveApiKey()       API Key 암호화 저장     │    │
│  │  - generate()         스트리밍 추론 요청       │    │
│  │  - stopGeneration()   스트리밍 중단            │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │ OkHttp HTTPS + SSE                │
│  ┌──────────────▼──────────────────────────────┐    │
│  │      AnthropicClient.kt (Kotlin)             │    │
│  │  - POST /v1/messages (스트리밍)               │    │
│  │  - SSE 파싱 → 토큰 단위 JS 이벤트 발행        │    │
│  │  - API Key: EncryptedSharedPreferences       │    │
│  └──────────────┬──────────────────────────────┘    │
│                 │ HTTPS                             │
│  ┌──────────────▼──────────────────────────────┐    │
│  │     Anthropic API (클라우드)                  │    │
│  │  model: claude-sonnet-4-5                    │    │
│  │  https://api.anthropic.com/v1/messages       │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 파일 구조

```
gemma4_apk/                           ← 프로젝트 루트 (이름 유지)
├── CLAUDE.md
├── package.json
├── capacitor.config.json
├── www/                              ← Capacitor web root (HTML UI)
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js                   ← 앱 초기화, 이벤트 핸들러
│   │   ├── bridge.js                ← Capacitor Plugin 호출 래퍼
│   │   ├── chat.js                  ← 채팅 메시지 렌더링
│   │   ├── camera.js                ← 카메라/이미지 처리
│   │   └── api-key-ui.js            ← API Key 입력/관리 화면 (신규)
│   └── lib/
│       └── marked.min.js            ← 마크다운 렌더링 (로컬 번들)
└── android/
    └── app/src/main/
        ├── java/com/gemma4/visionchat/
        │   ├── ClaudePlugin.kt       ← Capacitor 커스텀 플러그인 (신규)
        │   └── AnthropicClient.kt    ← API 통신 + SSE 파싱 (신규)
        └── AndroidManifest.xml
```

> **제거된 파일**: `GemmaPlugin.kt`, `ModelManager.kt`, `LlamaJNI.kt`, `llama_jni.cpp`, `CMakeLists.txt`  
> 온디바이스 추론 레이어 전체 불필요. NDK/JNI 빌드 없음.

---

## API Key 관리

### 저장 방식
- Android `EncryptedSharedPreferences` (AES256-GCM) 사용
- API Key는 앱 내부에만 저장, 외부 전송 없음
- 앱 삭제 시 자동 파기

### 최초 실행 플로우

```
앱 실행
    │
    ▼
API Key 등록 여부 확인 (EncryptedSharedPreferences)
    │
    ├── 등록됨 → 채팅 화면 바로 진입
    │
    └── 없음 → API Key 입력 화면
                    │
                    ▼
             사용자가 Anthropic API Key 입력
             (sk-ant-api03-... 형식 검증)
                    │
                    ▼
             API Key 유효성 확인
             (간단한 테스트 요청)
                    │
                    ▼
             EncryptedSharedPreferences 저장
                    │
                    ▼
             채팅 화면
```

### API Key 입력 화면 UI

```
┌─────────────────────────┐
│    Claude Vision Chat   │
│                         │
│    [Claude 로고]         │
│                         │
│  Anthropic API Key를    │
│  입력하세요              │
│                         │
│  [sk-ant-api03-...   ]  │
│                         │
│  API Key 발급:          │
│  console.anthropic.com  │
│                         │
│       [시작하기]         │
└─────────────────────────┘
```

---

## Capacitor 커스텀 플러그인 — ClaudePlugin

### JS에서 호출하는 API (bridge.js)

```javascript
// API Key 등록 여부 확인
const { hasKey } = await ClaudePlugin.getApiKeyStatus();

// API Key 저장 (암호화)
await ClaudePlugin.saveApiKey({ apiKey: 'sk-ant-api03-...' });

// API Key 삭제
await ClaudePlugin.deleteApiKey();

// 텍스트 추론 (스트리밍)
await ClaudePlugin.generate({
  prompt: "안녕하세요",
  history: [...],      // 대화 히스토리
  imageBase64: null    // 이미지 없음
});

// 멀티모달 추론 (스트리밍)
await ClaudePlugin.generate({
  prompt: "이 이미지를 분석해줘",
  history: [...],
  imageBase64: "/9j/4AAQ...",  // JPEG base64
  imageMediaType: "image/jpeg"
});

// 스트리밍 토큰 수신
ClaudePlugin.addListener('onToken', ({ token, done }) => {
  if (done) finishResponse();
  else appendToken(token);
});

// 생성 중단
await ClaudePlugin.stopGeneration();
```

### Kotlin 구현 핵심 (ClaudePlugin.kt + AnthropicClient.kt)

```kotlin
// ClaudePlugin.kt
@PluginMethod
fun generate(call: PluginCall) {
    val prompt      = call.getString("prompt") ?: ""
    val imageBase64 = call.getString("imageBase64")
    val mediaType   = call.getString("imageMediaType") ?: "image/jpeg"
    val historyArr  = call.getArray("history")

    call.resolve(JSObject().put("success", true)) // 즉시 resolve

    scope.launch(Dispatchers.IO) {
        anthropicClient.streamGenerate(
            prompt      = prompt,
            history     = historyArr,
            imageBase64 = imageBase64,
            mediaType   = mediaType,
            onToken     = { token ->
                notifyListeners("onToken", JSObject()
                    .put("token", token).put("done", false))
            },
            onDone      = {
                notifyListeners("onToken", JSObject()
                    .put("token", null as String?).put("done", true))
            },
            onError     = { msg ->
                notifyListeners("onToken", JSObject()
                    .put("error", msg).put("done", true))
            }
        )
    }
}

// AnthropicClient.kt — Anthropic Messages API 요청 구조
fun buildRequestBody(prompt, history, imageBase64, mediaType): RequestBody {
    // messages 배열 구성
    val messages = mutableListOf<JSONObject>()

    // 히스토리 추가
    history?.forEach { turn ->
        messages.add(JSONObject()
            .put("role", turn.role)
            .put("content", turn.content))
    }

    // 현재 사용자 메시지 (이미지 포함 시 content 배열)
    val userContent = if (imageBase64 != null) {
        JSONArray().apply {
            put(JSONObject()          // 이미지 블록
                .put("type", "image")
                .put("source", JSONObject()
                    .put("type", "base64")
                    .put("media_type", mediaType)
                    .put("data", imageBase64)))
            put(JSONObject()          // 텍스트 블록
                .put("type", "text")
                .put("text", prompt))
        }
    } else {
        prompt  // 텍스트만
    }
    messages.add(JSONObject().put("role", "user").put("content", userContent))

    return JSONObject()
        .put("model", "claude-sonnet-4-5")
        .put("max_tokens", 4096)
        .put("stream", true)
        .put("system", "한국어로 답변하세요.")
        .put("messages", JSONArray(messages))
        .toString()
        .toRequestBody("application/json".toMediaType())
}
```

---

## Anthropic API 스펙

### 엔드포인트

```
POST https://api.anthropic.com/v1/messages
```

### 요청 헤더

```
x-api-key: sk-ant-api03-...
anthropic-version: 2023-06-01
content-type: application/json
```

### 요청 바디 (텍스트)

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 4096,
  "stream": true,
  "system": "한국어로 답변하세요.",
  "messages": [
    { "role": "user", "content": "안녕하세요" }
  ]
}
```

### 요청 바디 (이미지 + 텍스트)

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 4096,
  "stream": true,
  "system": "한국어로 답변하세요.",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": "/9j/4AAQ..."
          }
        },
        { "type": "text", "text": "이 이미지를 분석해줘" }
      ]
    }
  ]
}
```

### SSE 스트리밍 응답 파싱

```
event: content_block_delta
data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"안녕"}}

event: message_stop
data: {"type":"message_stop"}
```

- `content_block_delta` → `delta.text` 추출 → JS `onToken` 이벤트
- `message_stop` → `done: true` 발행

---

## UI 설계 — 화면 구성

### 1. API Key 입력 화면 (최초 1회)

```
┌─────────────────────────┐
│   Claude Vision Chat    │
│                         │
│      [Claude 로고]       │
│                         │
│  Anthropic API Key 입력  │
│  ┌─────────────────────┐│
│  │ sk-ant-api03-...    ││
│  └─────────────────────┘│
│                         │
│  ⓘ console.anthropic.com│
│     에서 발급받으세요    │
│                         │
│        [시작하기]        │
└─────────────────────────┘
```

### 2. 채팅 화면 (메인)

```
┌─────────────────────────┐
│ ● Claude Vision   [⚙]   │  ← 헤더 (● = API 연결 상태)
├─────────────────────────┤
│                         │
│  [C] 안녕하세요! 텍스트  │
│      질문이나 이미지를   │
│      보내주세요.         │
│                         │
│        [이미지 썸네일]   │
│        이 음식이 뭐야? ▐ │  ← 사용자 메시지
│                         │
│  [C] 이 음식은 비빔밥    │
│      입니다. ...         │  ← AI 응답 (마크다운)
│                         │
│  [C] ●●●               │  ← 타이핑 인디케이터
│                         │
├─────────────────────────┤
│ ┌──────────────────────┐│
│ │[이미지 썸네일] ✕      ││  ← 이미지 첨부 시만 표시
│ └──────────────────────┘│
│ [📷][📁][입력창      ][↑]│
└─────────────────────────┘
```

### 메시지 버블 스타일

| 항목 | 스펙 |
|------|------|
| 사용자 메시지 | 오른쪽 정렬, `#1a73e8` 파란 배경, 흰 글씨 |
| AI 메시지 | 왼쪽 정렬, `#f1f3f4` 회색 배경, 마크다운 렌더링 |
| 이미지 첨부 | 버블 상단 썸네일 (최대 높이 200px), 탭 시 전체화면 |
| 로딩 | 점 3개 bouncing 애니메이션 |
| 에러 | 빨간 테두리 + 재시도 버튼 |
| 스트리밍 | 토큰 단위 실시간 텍스트 업데이트 (커서 깜빡임) |

---

## 이미지 처리 파이프라인

```
카메라 촬영 (Capacitor Camera)
또는 파일 선택 (input[type=file])
        │
        ▼
    FileReader / base64 추출
        │
        ▼
    Canvas 리사이즈
    - 최대 1568px (Claude API 권장 크기)
    - 최대 5MB 이하 (API 제한)
    - JPEG 품질 0.85
        │
        ▼
    입력 바 썸네일 미리보기 표시
        │
        ▼  (전송 시)
    ClaudePlugin.generate({ imageBase64, imageMediaType }) 호출
        │
        ▼ (Kotlin → Anthropic API)
    Messages API — content 배열에 image + text 블록 포함
        │
        ▼
    SSE 스트리밍 → 토큰 단위 JS 이벤트
```

---

## 대화 히스토리 관리

### Anthropic Messages 형식

```json
[
  { "role": "user",      "content": "이 이미지를 분석해줘" },
  { "role": "assistant", "content": "이 이미지는 비빔밥입니다..." },
  { "role": "user",      "content": "칼로리는?" }
]
```

### 히스토리 관리 규칙

- JS 측에서 `history` 배열 유지 (role/content 쌍)
- Claude API 컨텍스트: 최대 200K 토큰 (실질적으로 무제한)
- 실용적 제한: 최근 20턴만 전송 (비용 절감)
- 이미지는 해당 턴에만 포함, 후속 턴에서는 텍스트만 전송 (비용 절감)
- 히스토리는 `localStorage`에 세션 단위 저장

---

## 설정 화면

헤더 우측 ⚙ 버튼 → 하단 슬라이드업 패널:

| 설정 항목 | 타입 | 기본값 |
|-----------|------|--------|
| 응답 언어 | select | 한국어 |
| 응답 최대 길이 | slider 256~4096 | 4096 tokens |
| API Key 변경 | 버튼 | — |
| 대화 내역 초기화 | 버튼 | — |

> **제거된 설정**: Temperature, GPU 가속 토글, Wi-Fi 전용 다운로드  
> (Claude API 측에서 관리, 앱에서 노출 불필요)

---

## Capacitor 설정

```json
{
  "appId": "com.gemma4.visionchat",
  "appName": "Claude Vision Chat",
  "webDir": "www",
  "plugins": {
    "Camera": {
      "permissions": ["camera", "photos"]
    }
  }
}
```

### AndroidManifest.xml 권한

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.INTERNET" />
<!-- 모델 다운로드 불필요 → Foreground Service, POST_NOTIFICATIONS 제거 -->
```

---

## APK 빌드 단계

```bash
# 1. Node 의존성
npm install @capacitor/core @capacitor/cli @capacitor/camera @capacitor/android

# 2. 웹 파일 동기화
npx cap sync android

# 3. Android Studio 빌드 (NDK 불필요)
cd android && ./gradlew assembleDebug
```

> **이전 대비 간소화**: llama.cpp NDK 빌드, Vulkan 셰이더 컴파일, CMakeLists.txt 모두 불필요

---

## 구현 우선순위

### Phase 1 — API 통신 레이어 (Kotlin)
- [x] `ClaudePlugin.kt` — Capacitor 플러그인 기본 구조
- [ ] `AnthropicClient.kt` — OkHttp + SSE 스트리밍 구현
- [ ] API Key 암호화 저장 (EncryptedSharedPreferences)
- [ ] 텍스트 추론 스트리밍 동작 확인

### Phase 2 — 채팅 UI 업데이트
- [ ] `bridge.js` — `ClaudePlugin` 호출로 전환
- [ ] `api-key-ui.js` — API Key 입력/관리 화면
- [ ] `app.js` — 다운로드/로딩 화면 → API Key 화면으로 교체
- [ ] 스트리밍 토큰 렌더링 유지 (기존 로직 재사용)

### Phase 3 — Vision 기능
- [ ] 이미지 전처리 (Canvas 리사이즈 → 최대 1568px / 5MB 이하)
- [ ] 멀티모달 API 요청 구조 연결
- [ ] Capacitor Camera Plugin 연동 유지

### Phase 4 — 완성도
- [ ] 에러 처리 (401 Key 오류, 429 Rate limit, 네트워크 오류)
- [ ] 대화 히스토리 localStorage 저장 유지
- [ ] 설정 화면 정리
- [ ] APK 서명 및 배포

---

## 주요 제약사항 및 고려사항

1. **API Key 보안**: `sk-ant-api03-...` 키는 EncryptedSharedPreferences에 저장. 네트워크 전송 시 HTTPS만 사용.
2. **비용**: claude-sonnet-4-5 기준 입력 $3/MTok, 출력 $15/MTok. 히스토리 20턴 제한으로 비용 제어.
3. **이미지 제한**: Anthropic API — 이미지 1장당 최대 5MB, 최대 1568px. 앱에서 사전 리사이즈 필수.
4. **네트워크 필수**: 오프라인 사용 불가. 네트워크 오류 시 친화적 안내 메시지 표시.
5. **Rate Limit**: 429 오류 수신 시 자동 재시도 (exponential backoff) 또는 사용자 안내.
6. **컨텍스트 길이**: Claude claude-sonnet-4-5은 200K 토큰 컨텍스트. 실용적으로 20턴 제한 적용.
7. **스트리밍**: Anthropic SSE 형식 — `content_block_delta` 이벤트에서 `delta.text` 추출.
