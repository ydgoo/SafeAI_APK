package com.gemma4.visionchat

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/**
 * AnthropicClient — Anthropic Messages API 통신 (OkHttp + SSE 스트리밍)
 */
class AnthropicClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val ENDPOINT = "https://api.anthropic.com/v1/messages"
    private val MODEL    = "claude-sonnet-4-5"

    /**
     * SSE 스트리밍 추론 요청
     *
     * @param apiKey        Anthropic API Key
     * @param prompt        현재 사용자 메시지
     * @param history       이전 대화 (JSArray: [{role, content}])
     * @param imageBase64   이미지 base64 (null이면 텍스트 전용)
     * @param mediaType     이미지 MIME 타입 (기본 image/jpeg)
     * @param maxTokens     최대 출력 토큰
     * @param systemPrompt  시스템 프롬프트 (null이면 기본값 사용)
     * @param onToken       토큰 콜백 (token: String? — null 이면 완료)
     * @param onError       오류 콜백
     * @param stopFlag      중단 플래그 (AtomicBoolean)
     */
    suspend fun streamGenerate(
        apiKey:       String,
        prompt:       String,
        history:      JSONArray?,
        imageBase64:  String?,
        mediaType:    String = "image/jpeg",
        maxTokens:    Int    = 4096,
        systemPrompt: String?,
        onToken:      (String?) -> Unit,
        onError:      (String) -> Unit,
        stopFlag:     java.util.concurrent.atomic.AtomicBoolean
    ) = withContext(Dispatchers.IO) {

        // ── messages 구성 ─────────────────────────────────────────────
        val messages = JSONArray()

        // 히스토리 (최근 40개 항목 = 20턴)
        val hist = history ?: JSONArray()
        val start = maxOf(0, hist.length() - 40)
        for (i in start until hist.length()) {
            val h = hist.optJSONObject(i) ?: continue
            val role    = if (h.optString("role") == "model") "assistant" else h.optString("role")
            val content = h.optString("content")
            if (role.isBlank() || content.isBlank()) continue
            messages.put(JSONObject().put("role", role).put("content", content))
        }

        // 현재 사용자 메시지
        val userContent: Any = if (!imageBase64.isNullOrEmpty()) {
            JSONArray().apply {
                put(JSONObject()
                    .put("type", "image")
                    .put("source", JSONObject()
                        .put("type", "base64")
                        .put("media_type", mediaType)
                        .put("data", imageBase64)))
                put(JSONObject()
                    .put("type", "text")
                    .put("text", prompt.ifBlank { "이 이미지를 분석해줘" }))
            }
        } else {
            prompt
        }
        messages.put(JSONObject().put("role", "user").put("content", userContent))

        // ── 시스템 프롬프트 ───────────────────────────────────────────
        val resolvedSystem = systemPrompt ?: "한국어로 답변하세요."

        // ── 요청 바디 ──────────────────────────────────────────────────
        val body = JSONObject()
            .put("model", MODEL)
            .put("max_tokens", maxTokens)
            .put("stream", true)
            .put("system", resolvedSystem)
            .put("messages", messages)
            .toString()
            .toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url(ENDPOINT)
            .post(body)
            .addHeader("x-api-key", apiKey)
            .addHeader("anthropic-version", "2023-06-01")
            .addHeader("content-type", "application/json")
            .build()

        try {
            val response = client.newCall(request).execute()

            if (!response.isSuccessful) {
                val code = response.code
                var msg  = "API 오류 ($code)"
                try {
                    val json = JSONObject(response.body?.string() ?: "")
                    msg = json.optJSONObject("error")?.optString("message") ?: msg
                    if (code == 401) msg = "유효하지 않은 API Key입니다."
                    if (code == 429) msg = "요청 한도(Rate Limit)에 도달했습니다. 잠시 후 다시 시도하세요."
                } catch (_: Exception) {}
                onError(msg)
                return@withContext
            }

            // ── SSE 파싱 ──────────────────────────────────────────────
            val reader = BufferedReader(InputStreamReader(response.body!!.byteStream()))
            var line: String?
            while (reader.readLine().also { line = it } != null) {
                if (stopFlag.get()) break
                val l = line ?: continue
                if (!l.startsWith("data:")) continue
                val data = l.removePrefix("data:").trim()
                if (data.isEmpty() || data == "[DONE]") continue
                try {
                    val obj = JSONObject(data)
                    when (obj.optString("type")) {
                        "content_block_delta" -> {
                            val delta = obj.optJSONObject("delta")
                            if (delta?.optString("type") == "text_delta") {
                                onToken(delta.optString("text"))
                            }
                        }
                        "message_stop" -> {
                            onToken(null)   // done
                            return@withContext
                        }
                        "error" -> {
                            val errMsg = obj.optJSONObject("error")?.optString("message") ?: "스트리밍 오류"
                            onError(errMsg)
                            return@withContext
                        }
                    }
                } catch (_: Exception) {}
            }
            reader.close()
            onToken(null)  // 스트림 정상 종료

        } catch (e: Exception) {
            if (!stopFlag.get()) {
                onError("네트워크 오류: ${e.message}")
            }
        }
    }
}
