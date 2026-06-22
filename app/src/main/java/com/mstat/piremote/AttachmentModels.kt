package com.mstat.piremote

import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.Base64
import kotlin.math.roundToInt

const val MAX_BINARY_ATTACHMENT_BYTES = 5 * 1024 * 1024
const val MAX_TEXT_ATTACHMENT_BYTES = 200 * 1024
const val MAX_WEBSOCKET_SEND_BYTES = 15 * 1024 * 1024

enum class AttachmentKind { Image, Text, Binary }

data class AttachmentItem(
    val name: String,
    val mimeType: String,
    val kind: AttachmentKind,
    val sizeBytes: Int,
    val base64: String? = null,
    val text: String? = null,
) {
    val chipLabel: String
        get() = "$name • ${attachmentTypeLabel(mimeType, kind)} • ${formatAttachmentSize(sizeBytes)}"
}

data class WireAttachments(val images: JSONArray, val files: JSONArray)

fun createAttachmentForStream(name: String, mimeType: String?, input: InputStream): AttachmentItem {
    val normalizedMime = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
    val safeName = name.ifBlank { fallbackAttachmentName(normalizedMime) }
    val kind = classifyAttachment(normalizedMime, safeName)
    val limit = if (kind == AttachmentKind.Text) MAX_TEXT_ATTACHMENT_BYTES else MAX_BINARY_ATTACHMENT_BYTES
    val bytes = readAtMost(input, limit + 1)
    require(bytes.size <= limit) {
        if (kind == AttachmentKind.Text) "$safeName is larger than 200KB text limit" else "$safeName is larger than 5MB"
    }
    return createAttachmentForBytes(safeName, normalizedMime, bytes)
}

fun createAttachmentForBytes(name: String, mimeType: String?, bytes: ByteArray): AttachmentItem {
    val normalizedMime = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
    val safeName = name.ifBlank { fallbackAttachmentName(normalizedMime) }
    val kind = classifyAttachment(normalizedMime, safeName, bytes)
    return when (kind) {
        AttachmentKind.Image -> {
            require(bytes.size <= MAX_BINARY_ATTACHMENT_BYTES) { "$safeName is larger than 5MB" }
            AttachmentItem(
                name = safeName,
                mimeType = normalizedMime,
                kind = kind,
                sizeBytes = bytes.size,
                base64 = Base64.getEncoder().encodeToString(bytes),
            )
        }
        AttachmentKind.Text -> {
            require(bytes.size <= MAX_TEXT_ATTACHMENT_BYTES) { "$safeName is larger than 200KB text limit" }
            AttachmentItem(
                name = safeName,
                mimeType = normalizedMime,
                kind = kind,
                sizeBytes = bytes.size,
                text = bytes.toString(Charsets.UTF_8),
            )
        }
        AttachmentKind.Binary -> {
            require(bytes.size <= MAX_BINARY_ATTACHMENT_BYTES) { "$safeName is larger than 5MB" }
            AttachmentItem(
                name = safeName,
                mimeType = normalizedMime,
                kind = kind,
                sizeBytes = bytes.size,
                base64 = Base64.getEncoder().encodeToString(bytes),
            )
        }
    }
}

private fun readAtMost(input: InputStream, maxBytes: Int): ByteArray {
    val output = ByteArrayOutputStream(maxBytes.coerceAtMost(8192))
    val buffer = ByteArray(8192)
    var remaining = maxBytes
    while (remaining > 0) {
        val read = input.read(buffer, 0, minOf(buffer.size, remaining))
        if (read == -1) break
        output.write(buffer, 0, read)
        remaining -= read
    }
    return output.toByteArray()
}

fun buildPromptJson(type: String, text: String? = null, attachments: List<AttachmentItem> = emptyList(), id: String = System.currentTimeMillis().toString()): JSONObject {
    val json = JSONObject()
        .put("id", id)
        .put("type", type)
    if (text != null) json.put("text", text)
    if (type in listOf("prompt", "steer", "follow_up") && attachments.isNotEmpty()) {
        val (images, files) = splitAttachmentsForWire(attachments)
        if (images.length() > 0) json.put("images", images)
        if (files.length() > 0) json.put("files", files)
    }
    validateOutboundPayloadSize(json.toString())
    return json
}

fun validateOutboundPayloadSize(payload: String) {
    require(payload.toByteArray(Charsets.UTF_8).size <= MAX_WEBSOCKET_SEND_BYTES) {
        "Message with attachments is too large to send; remove an attachment and try again."
    }
}

fun hasBinaryFileAttachment(attachments: List<AttachmentItem>): Boolean = attachments.any { it.kind == AttachmentKind.Binary }

fun splitAttachmentsForWire(attachments: List<AttachmentItem>): WireAttachments {
    val images = JSONArray()
    val files = JSONArray()
    attachments.forEach { attachment ->
        when (attachment.kind) {
            AttachmentKind.Image -> images.put(
                JSONObject()
                    .put("name", attachment.name)
                    .put("mimeType", attachment.mimeType)
                    .put("data", attachment.base64),
            )
            AttachmentKind.Text -> files.put(
                JSONObject()
                    .put("name", attachment.name)
                    .put("mimeType", attachment.mimeType)
                    .put("text", attachment.text),
            )
            AttachmentKind.Binary -> files.put(
                JSONObject()
                    .put("name", attachment.name)
                    .put("mimeType", attachment.mimeType)
                    .put("data", attachment.base64)
                    .put("encoding", "base64"),
            )
        }
    }
    return WireAttachments(images, files)
}

fun classifyAttachment(mimeType: String, name: String, bytes: ByteArray? = null): AttachmentKind = when {
    hasKnownDocumentSignature(bytes) -> AttachmentKind.Binary
    mimeType.startsWith("image/") -> AttachmentKind.Image
    (isTextLikeMimeType(mimeType) || isTextLikeExtension(name)) && !hasBinarySignature(bytes) && isValidInlineText(bytes) -> AttachmentKind.Text
    else -> AttachmentKind.Binary
}

fun fallbackAttachmentName(mimeType: String): String = when (mimeType) {
    "application/pdf" -> "attachment.pdf"
    else -> "attachment"
}

fun formatAttachmentSize(bytes: Int): String = when {
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${((bytes / 1024.0).roundToInt())} KB"
    else -> String.format("%.1f MB", bytes / (1024.0 * 1024.0))
}

private fun attachmentTypeLabel(mimeType: String, kind: AttachmentKind): String = when {
    mimeType == "application/pdf" -> "PDF"
    kind == AttachmentKind.Image -> "Image"
    kind == AttachmentKind.Text -> "Text"
    else -> "File"
}

private fun hasKnownDocumentSignature(bytes: ByteArray?): Boolean {
    if (bytes == null) return false
    if (bytes.size >= 5 && bytes.copyOfRange(0, 5).toString(Charsets.US_ASCII) == "%PDF-") return true
    if (bytes.size >= 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4B.toByte() && bytes[2] == 0x03.toByte() && bytes[3] == 0x04.toByte()) return true
    return false
}

private fun hasBinarySignature(bytes: ByteArray?): Boolean {
    if (bytes == null) return false
    if (hasKnownDocumentSignature(bytes)) return true
    if (bytes.any { it == 0.toByte() }) return true
    val sample = bytes.take(4096)
    if (sample.isEmpty()) return false
    val controlCount = sample.count { byte ->
        val value = byte.toInt() and 0xff
        value < 0x20 && value !in listOf(0x09, 0x0a, 0x0d)
    }
    return controlCount > sample.size / 20
}

private fun isValidInlineText(bytes: ByteArray?): Boolean {
    if (bytes == null) return true
    return try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
        true
    } catch (_: CharacterCodingException) {
        false
    }
}

private fun isTextLikeMimeType(mimeType: String): Boolean {
    val lower = mimeType.lowercase()
    return lower.startsWith("text/") || lower in setOf(
        "application/json",
        "application/xml",
        "application/csv",
        "application/javascript",
        "application/x-javascript",
        "application/x-sh",
        "application/x-yaml",
        "application/yaml",
        "application/toml",
        "application/sql",
        "image/svg+xml",
    ) || lower.endsWith("+json") || lower.endsWith("+xml")
}

private fun isTextLikeExtension(name: String): Boolean = name.substringAfterLast('.', "").lowercase() in setOf(
    "txt", "md", "markdown", "json", "xml", "csv", "tsv", "kt", "java", "js", "ts", "jsx", "tsx",
    "py", "rb", "go", "rs", "c", "cc", "cpp", "h", "hpp", "cs", "sh", "bash", "zsh", "ps1", "yml", "yaml", "toml", "ini", "sql",
)
