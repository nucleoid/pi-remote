package com.pragmaticcoder.piremote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    private fun fixture(name: String): String = checkNotNull(javaClass.classLoader?.getResource("protocol-v2/$name")).readText()

    @Test
    fun sharedV2FixturesPreserveHelloHistoryLifecycleToolsAndUnknownTolerance() {
        val hello = parseIncoming(fixture("hello.json"))
        assertEquals(false, hello.working)
        assertTrue(hello.sessionInfo!!.startsWith("Idle"))

        val history = parseIncoming(fixture("history.json"))
        assertEquals(listOf(ChatKind.User, ChatKind.Assistant), history.messages.map { it.kind })

        val fixtureEvents = listOf("lifecycle.jsonl", "tools.jsonl")
            .flatMap { fixture(it).lineSequence().filter(String::isNotBlank).toList() }
        assertTrue(fixtureEvents.map(::parseIncoming).any { it.working == true })
        assertTrue(parseIncoming("{\"type\":\"future_v2_event\",\"value\":1}").messages.isNotEmpty())
    }

    @Test
    fun parsePiRemoteUri_appliesHostPortAndDecodedToken() {
        val parsed = parsePiRemoteUri(
            "pi-remote://demo-laptop.tailnet.ts.net:37892?token=secret%20token",
            ConnectionSettings("old-host", "37891", "old-token"),
        )

        assertEquals(ConnectionSettings("demo-laptop.tailnet.ts.net", "37892", "secret token"), parsed)
    }

    @Test
    fun parsePiRemoteUri_preservesExistingValuesWhenOptionalPartsAreMissing() {
        val parsed = parsePiRemoteUri(
            "pi-remote://demo-laptop.tailnet.ts.net",
            ConnectionSettings("old-host", "37891", "old-token"),
        )

        assertEquals(ConnectionSettings("demo-laptop.tailnet.ts.net", "37891", "old-token"), parsed)
    }

    @Test
    fun parsePiRemoteUri_rejectsOtherSchemesAndMalformedUris() {
        assertNull(parsePiRemoteUri("https://demo-laptop.tailnet.ts.net:37891?token=secret", ConnectionSettings("h", "p", "t")))
        assertNull(parsePiRemoteUri("not a uri", ConnectionSettings("h", "p", "t")))
    }

    @Test
    fun extractMessageText_returnsPlainStringContent() {
        val message = JSONObject().put("content", "hello from pi")

        assertEquals("hello from pi", extractMessageText(message))
    }

    @Test
    fun extractMessageText_flattensMultimodalContentInOrder() {
        val message = JSONObject().put(
            "content",
            JSONArray()
                .put(JSONObject().put("type", "text").put("text", "first"))
                .put(JSONObject().put("type", "image"))
                .put(JSONObject().put("type", "text").put("text", "second")),
        )

        assertEquals("first\n[image]\nsecond", extractMessageText(message))
    }

    @Test
    fun describeState_includesIdleModelAndCwd() {
        val state = JSONObject()
            .put("isIdle", false)
            .put("cwd", "C:\\Users\\demo\\source\\example-app")
            .put("model", JSONObject().put("provider", "openai").put("id", "gpt-demo"))

        assertEquals("Working • openai/gpt-demo • C:\\Users\\demo\\source\\example-app", describeState(state))
    }

    @Test
    fun parseIncoming_helloUpdatesSessionWithoutMessages() {
        val effects = parseIncoming(
            JSONObject()
                .put("type", "hello")
                .put("state", JSONObject().put("isIdle", true).put("cwd", "/home/demo/example"))
                .toString(),
        )

        assertEquals("Idle • unknown model • /home/demo/example", effects.sessionInfo)
        assertEquals(false, effects.working)
        assertTrue(effects.messages.isEmpty())
    }

    @Test
    fun parseIncoming_historyAddsOnlyUserAndAssistantMessagesAndUpdatesState() {
        val effects = parseIncoming(
            JSONObject()
                .put("type", "history")
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "user").put("content", "question"))
                        .put(JSONObject().put("role", "assistant").put("content", "answer"))
                        .put(JSONObject().put("role", "tool").put("content", "ignored"))
                        .put(JSONObject().put("role", "assistant").put("content", "")),
                )
                .put("state", JSONObject().put("isIdle", false))
                .toString(),
        )

        assertEquals(listOf(ChatKind.User, ChatKind.Assistant), effects.messages.map { it.kind })
        assertEquals(listOf("question", "answer"), effects.messages.map { it.text })
        assertEquals("Working • unknown model", effects.sessionInfo)
        assertEquals(true, effects.working)
    }

    @Test
    fun parseIncoming_suppressesEchoedUserMessages() {
        val effects = parseIncoming(
            JSONObject()
                .put("type", "user_message")
                .put("message", JSONObject().put("content", "already shown"))
                .toString(),
            suppressUserEcho = { it == "already shown" },
        )

        assertTrue(effects.messages.isEmpty())
    }

    @Test
    fun parseIncoming_assistantDeltaIsSeparatedFromCompletedMessages() {
        val effects = parseIncoming(JSONObject().put("type", "assistant_delta").put("text", "partial").toString())

        assertEquals(listOf("partial"), effects.assistantDeltas)
        assertTrue(effects.messages.isEmpty())
    }

    @Test
    fun parseIncoming_toolStartUsesFirstCommandLineAsSummary() {
        val effects = parseIncoming(
            JSONObject()
                .put("type", "tool_start")
                .put("toolName", "bash")
                .put("toolCallId", "tool-1")
                .put("args", JSONObject().put("command", "./gradlew test\nextra line"))
                .toString(),
        )

        assertEquals(1, effects.toolUpdates.size)
        assertEquals(IncomingToolUpdate("tool-1", "bash running…", "./gradlew test\nextra line", false), effects.toolUpdates.single())
    }

    @Test
    fun parseIncoming_toolEndMarksErrorsAndSuccesses() {
        val ok = parseIncoming(JSONObject().put("type", "tool_end").put("toolName", "read").put("toolCallId", "t1").toString())
        val failed = parseIncoming(JSONObject().put("type", "tool_end").put("toolName", "bash").put("toolCallId", "t2").put("isError", true).toString())

        assertEquals(IncomingToolUpdate("t1", "read finished", "OK", true), ok.toolUpdates.single())
        assertEquals(IncomingToolUpdate("t2", "bash failed", "Error", true), failed.toolUpdates.single())
    }

    @Test
    fun parseIncoming_toolStartAndEndSurfaceExpandableDetails() {
        val start = parseIncoming(
            JSONObject()
                .put("type", "tool_start")
                .put("toolName", "edit")
                .put("toolCallId", "edit-1")
                .put("args", JSONObject().put("path", "MainActivity.kt").put("oldText", "before").put("newText", "after"))
                .toString(),
        )
        val end = parseIncoming(
            JSONObject()
                .put("type", "tool_end")
                .put("toolName", "edit")
                .put("toolCallId", "edit-1")
                .put("result", JSONObject().put("changed", true))
                .toString(),
        )

        assertTrue(start.toolUpdates.single().text.contains("MainActivity.kt"))
        assertTrue(start.toolUpdates.single().text.contains("oldText"))
        assertTrue(end.toolUpdates.single().text.contains("changed"))
    }

    @Test
    fun parseIncoming_responseUpdatesStateAndSurfacesErrors() {
        val effects = parseIncoming(
            JSONObject()
                .put("type", "response")
                .put("success", false)
                .put("error", "bad token")
                .put("data", JSONObject().put("state", JSONObject().put("isIdle", true).put("cwd", "/repo")))
                .toString(),
        )

        assertEquals("Idle • unknown model • /repo", effects.sessionInfo)
        assertEquals(false, effects.working)
        assertEquals(ChatKind.Error, effects.messages.single().kind)
        assertEquals("Command failed", effects.messages.single().title)
        assertEquals("bad token", effects.messages.single().text)
    }

    @Test
    fun parseIncoming_agentLifecycleTogglesWorkingAndClearsActiveAssistant() {
        val start = parseIncoming(JSONObject().put("type", "agent_start").toString())
        val end = parseIncoming(JSONObject().put("type", "agent_end").toString())

        assertEquals(true, start.working)
        assertTrue(start.clearActiveAssistant)
        assertEquals(false, end.working)
        assertTrue(end.clearActiveAssistant)
    }

    @Test
    fun parseIncoming_malformedJsonBecomesRawSystemEvent() {
        val effects = parseIncoming("not-json")

        assertEquals(ChatKind.System, effects.messages.single().kind)
        assertEquals("Raw event", effects.messages.single().title)
        assertEquals("not-json", effects.messages.single().text)
        assertNull(effects.working)
    }

    @Test
    fun summarizeRawEvent_usesStableSummariesForNoisyEvents() {
        assertEquals("Assistant message received", summarizeRawEvent(JSONObject().put("type", "assistant_message")))
        assertEquals("Tool call received", summarizeRawEvent(JSONObject().put("type", "tool_call")))
    }

    @Test
    fun sharedV2CommandFixtureContainsCurrentCommandsAndLegacyAlias() {
        val commands = fixture("commands.jsonl").lineSequence().filter(String::isNotBlank).map { JSONObject(it) }.toList()
        assertEquals(setOf("ping", "get_state", "get_history", "prompt", "steer", "follow_up", "followUp", "abort"), commands.map { it.getString("type") }.toSet())
        assertTrue(commands.filter { it.getString("type") == "prompt" }.single().has("deliverAs"))
    }
}
