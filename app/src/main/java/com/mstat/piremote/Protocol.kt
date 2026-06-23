package com.mstat.piremote

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

internal data class ConnectionSettings(
    val host: String,
    val port: String,
    val token: String,
)

internal fun parsePiRemoteUri(
    uriText: String,
    current: ConnectionSettings,
): ConnectionSettings? {
    return runCatching {
        val uri = URI(uriText)
        if (uri.scheme != "pi-remote") return@runCatching null
        current.copy(
            host = uri.host?.takeIf { it.isNotBlank() } ?: current.host,
            port = uri.port.takeIf { it > 0 }?.toString() ?: current.port,
            token = queryParameter(uri.rawQuery, "token") ?: current.token,
        )
    }.getOrNull()
}

private fun queryParameter(rawQuery: String?, name: String): String? {
    if (rawQuery.isNullOrBlank()) return null
    return rawQuery.split('&')
        .mapNotNull { part ->
            val separator = part.indexOf('=')
            if (separator < 0) return@mapNotNull null
            val key = urlDecode(part.substring(0, separator))
            val value = urlDecode(part.substring(separator + 1))
            key to value
        }
        .firstOrNull { it.first == name }
        ?.second
}

private fun urlDecode(value: String): String = URLDecoder.decode(value, StandardCharsets.UTF_8.name())

internal data class IncomingChatMessage(
    val kind: ChatKind,
    val title: String,
    val text: String,
)

internal data class IncomingToolUpdate(
    val toolCallId: String,
    val title: String,
    val text: String,
    val done: Boolean,
)

internal data class IncomingEffects(
    val messages: List<IncomingChatMessage> = emptyList(),
    val assistantDeltas: List<String> = emptyList(),
    val toolUpdates: List<IncomingToolUpdate> = emptyList(),
    val sessionInfo: String? = null,
    val working: Boolean? = null,
    val supportsBinaryFileAttachments: Boolean? = null,
    val clearActiveAssistant: Boolean = false,
)

internal fun parseIncoming(
    text: String,
    suppressUserEcho: (String) -> Boolean = { false },
    fallbackToolCallId: () -> String = { "tool-${System.nanoTime()}" },
): IncomingEffects {
    return try {
        val obj = JSONObject(text)
        when (obj.optString("type")) {
            "hello" -> {
                val state = obj.optJSONObject("state")
                val capabilities = obj.optJSONObject("capabilities")
                IncomingEffects(
                    sessionInfo = describeState(state),
                    working = !(state?.optBoolean("isIdle", true) ?: true),
                    supportsBinaryFileAttachments = obj.optInt("protocolVersion", 1) >= 2 || capabilities?.optBoolean("binaryFileAttachments", false) == true,
                )
            }
            "user_message" -> {
                val textContent = extractMessageText(obj.optJSONObject("message"))
                if (textContent.isNotBlank() && !suppressUserEcho(textContent)) {
                    IncomingEffects(messages = listOf(IncomingChatMessage(ChatKind.User, "User", textContent)))
                } else {
                    IncomingEffects()
                }
            }
            "history" -> parseHistory(obj)
            "assistant_delta" -> IncomingEffects(assistantDeltas = listOf(obj.optString("text")))
            "thinking_delta" -> IncomingEffects()
            "tool_start" -> {
                val toolName = obj.optString("toolName")
                val toolCallId = obj.optString("toolCallId", fallbackToolCallId())
                val details = toolStartDetails(obj.optJSONObject("args"))
                IncomingEffects(toolUpdates = listOf(IncomingToolUpdate(toolCallId, "$toolName running…", details, false)))
            }
            "tool_update" -> {
                val toolName = obj.optString("toolName")
                val toolCallId = obj.optString("toolCallId", fallbackToolCallId())
                val partial = jsonValueToDisplay(obj.opt("partialResult"))
                if (partial.isBlank()) IncomingEffects()
                else IncomingEffects(toolUpdates = listOf(IncomingToolUpdate(toolCallId, "$toolName running…", partial, false)))
            }
            "tool_end" -> {
                val toolName = obj.optString("toolName")
                val toolCallId = obj.optString("toolCallId", fallbackToolCallId())
                val failed = obj.optBoolean("isError")
                val status = if (failed) "Error" else "OK"
                val result = jsonValueToDisplay(obj.opt("result"))
                IncomingEffects(toolUpdates = listOf(IncomingToolUpdate(toolCallId, "$toolName ${if (failed) "failed" else "finished"}", result.ifBlank { status }, true)))
            }
            "agent_start" -> IncomingEffects(
                sessionInfo = obj.optJSONObject("state")?.let { describeState(it) },
                working = true,
                clearActiveAssistant = true,
            )
            "agent_end" -> IncomingEffects(
                sessionInfo = obj.optJSONObject("state")?.let { describeState(it) },
                working = false,
                clearActiveAssistant = true,
            )
            "assistant_message" -> IncomingEffects()
            "tool_call" -> IncomingEffects()
            "session_start" -> IncomingEffects(sessionInfo = obj.optJSONObject("state")?.let { describeState(it) })
            "session_shutdown" -> IncomingEffects()
            "queue_update" -> IncomingEffects()
            "response" -> parseResponse(obj)
            "error" -> IncomingEffects(messages = listOf(IncomingChatMessage(ChatKind.Error, "Remote error", obj.optString("error"))))
            "client_count" -> IncomingEffects()
            else -> parseUnknownEvent(obj, suppressUserEcho)
        }
    } catch (_: Exception) {
        IncomingEffects(messages = listOf(IncomingChatMessage(ChatKind.System, "Raw event", text)))
    }
}

private fun toolStartDetails(args: JSONObject?): String {
    if (args == null) return "Running…"
    val command = args.optString("command", "").orEmpty()
    if (command.isNotBlank()) return command
    return jsonValueToDisplay(args).ifBlank { "Running…" }
}

private fun jsonValueToDisplay(value: Any?): String {
    if (value == null || value == JSONObject.NULL) return ""
    return when (value) {
        is JSONObject -> value.toString(2)
        is JSONArray -> value.toString(2)
        else -> value.toString()
    }
}

private fun parseHistory(obj: JSONObject): IncomingEffects {
    val messages = mutableListOf<IncomingChatMessage>()
    val history = obj.optJSONArray("messages")
    if (history != null) {
        for (i in 0 until history.length()) {
            val message = history.optJSONObject(i) ?: continue
            val role = message.optString("role")
            val textContent = extractMessageText(message)
            if (textContent.isBlank()) continue
            when (role) {
                "user" -> messages += IncomingChatMessage(ChatKind.User, "User", textContent)
                "assistant" -> messages += IncomingChatMessage(ChatKind.Assistant, "Assistant", textContent)
            }
        }
    }
    val state = obj.optJSONObject("state")
    return IncomingEffects(
        messages = messages,
        sessionInfo = state?.let { describeState(it) },
        working = state?.let { !it.optBoolean("isIdle", true) },
    )
}

private fun parseResponse(obj: JSONObject): IncomingEffects {
    val data = obj.optJSONObject("data")
    val state = if (data?.has("cwd") == true || data?.has("state") == true) data.optJSONObject("state") ?: data else null
    val message = if (!obj.optBoolean("success")) {
        listOf(IncomingChatMessage(ChatKind.Error, "Command failed", obj.optString("error")))
    } else {
        emptyList()
    }
    return IncomingEffects(
        messages = message,
        sessionInfo = state?.let { describeState(it) },
        working = state?.let { !it.optBoolean("isIdle", true) },
    )
}

private fun parseUnknownEvent(obj: JSONObject, suppressUserEcho: (String) -> Boolean): IncomingEffects {
    val eventType = obj.optString("type", "Event")
    if (eventType == "user_message") {
        val textContent = extractMessageText(obj.optJSONObject("message"))
        return if (textContent.isNotBlank() && !suppressUserEcho(textContent)) {
            IncomingEffects(messages = listOf(IncomingChatMessage(ChatKind.User, "User", textContent)))
        } else {
            IncomingEffects()
        }
    }
    return if (eventType != "session_shutdown") {
        IncomingEffects(messages = listOf(IncomingChatMessage(ChatKind.System, eventType, summarizeRawEvent(obj))))
    } else {
        IncomingEffects()
    }
}

internal fun summarizeRawEvent(obj: JSONObject): String {
    return when (obj.optString("type")) {
        "assistant_message" -> "Assistant message received"
        "tool_call" -> "Tool call received"
        else -> obj.toString().take(500)
    }
}

internal fun extractMessageText(message: JSONObject?): String {
    if (message == null) return ""
    val content = message.opt("content") ?: return ""
    return when (content) {
        is String -> content
        is JSONArray -> buildString {
            for (i in 0 until content.length()) {
                val item = content.optJSONObject(i) ?: continue
                when (item.optString("type")) {
                    "text" -> {
                        if (isNotEmpty()) append("\n")
                        append(item.optString("text"))
                    }
                    "image" -> {
                        if (isNotEmpty()) append("\n")
                        append("[image]")
                    }
                }
            }
        }
        else -> ""
    }
}

internal fun describeState(state: JSONObject?): String {
    if (state == null) return "No session state"
    val cwd = state.optString("cwd", "")
    val idle = state.optBoolean("isIdle", true)
    val model = state.optJSONObject("model")
    val modelText = if (model != null) "${model.optString("provider")}/${model.optString("id")}" else "unknown model"
    return listOf(
        if (idle) "Idle" else "Working",
        modelText,
        cwd,
    ).filter { it.isNotBlank() }.joinToString(" • ")
}
