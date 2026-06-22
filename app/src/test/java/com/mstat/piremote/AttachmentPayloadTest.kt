package com.mstat.piremote

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class AttachmentPayloadTest {
    @Test
    fun pdfIsBinaryFilePayloadWithChipMetadata() {
        val attachment = createAttachmentForBytes(
            name = "1000006477.pdf",
            mimeType = "application/pdf",
            bytes = "%PDF-1.7 binary-ish".toByteArray(),
        )

        assertEquals(AttachmentKind.Binary, attachment.kind)
        assertNull("PDF bytes must not be decoded into text", attachment.text)
        assertNotNull(attachment.base64)
        assertEquals("1000006477.pdf • PDF • 19 B", attachment.chipLabel)

        val payload = splitAttachmentsForWire(listOf(attachment))
        assertEquals(0, payload.images.length())
        assertEquals(1, payload.files.length())
        val file = payload.files.getJSONObject(0)
        assertEquals("base64", file.getString("encoding"))
        assertTrue(file.has("data"))
        assertFalse(file.has("text"))
    }

    @Test
    fun imageMimeWithPdfBytesIsStillBinary() {
        val attachment = createAttachmentForBytes("fake.png", "image/png", "%PDF-1.7".toByteArray())

        assertEquals(AttachmentKind.Binary, attachment.kind)
        assertEquals("base64", splitAttachmentsForWire(listOf(attachment)).files.getJSONObject(0).getString("encoding"))
    }

    @Test
    fun mislabeledPdfIsStillBinary() {
        val attachment = createAttachmentForBytes("fake.txt", "text/plain", "%PDF-1.7".toByteArray())

        assertEquals(AttachmentKind.Binary, attachment.kind)
        assertNull(attachment.text)
        val payload = splitAttachmentsForWire(listOf(attachment))
        assertEquals("base64", payload.files.getJSONObject(0).getString("encoding"))
    }

    @Test
    fun oversizedOutboundJsonIsRejectedBeforeSend() {
        val attachment = createAttachmentForBytes("large.pdf", "application/pdf", ByteArray(MAX_BINARY_ATTACHMENT_BYTES))
        val error = assertThrows(IllegalArgumentException::class.java) {
            validateOutboundPayloadSize(buildPromptJson("prompt", "", List(4) { attachment }).toString())
        }
        assertTrue(error.message!!.contains("too large to send"))
    }

    @Test
    fun textAndImagesKeepExistingWireShapes() {
        val text = createAttachmentForBytes("notes.txt", "text/plain", "hello".toByteArray())
        val image = createAttachmentForBytes("photo.png", "image/png", byteArrayOf(-119, 80, 78, 71, 13, 10, 26, 10))

        assertEquals(AttachmentKind.Text, text.kind)
        assertEquals("hello", text.text)
        assertEquals(AttachmentKind.Image, image.kind)

        val payload = splitAttachmentsForWire(listOf(text, image))
        assertEquals(1, payload.images.length())
        assertEquals(1, payload.files.length())
        assertEquals("hello", payload.files.getJSONObject(0).getString("text"))
        assertFalse(payload.files.getJSONObject(0).has("encoding"))
    }

    @Test
    fun oversizedBinaryIsRejected() {
        val tooLarge = ByteArray(MAX_BINARY_ATTACHMENT_BYTES + 1)
        val error = assertThrows(IllegalArgumentException::class.java) {
            createAttachmentForBytes("large.pdf", "application/pdf", tooLarge)
        }
        assertTrue(error.message!!.contains("larger than 5MB"))
    }

    @Test
    fun streamReadsStopAtAttachmentLimit() {
        val tooLarge = ByteArray(MAX_BINARY_ATTACHMENT_BYTES + 2)
        val error = assertThrows(IllegalArgumentException::class.java) {
            createAttachmentForStream("large.pdf", "application/pdf", ByteArrayInputStream(tooLarge))
        }
        assertTrue(error.message!!.contains("larger than 5MB"))
    }
}
