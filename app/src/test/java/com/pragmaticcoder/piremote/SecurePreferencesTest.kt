package com.pragmaticcoder.piremote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SecurePreferencesTest {
    @Test
    fun migrationPlanCopiesOnlyConnectionPreferencesAndRemovesPlaintextToken() {
        val result = planPlaintextPreferenceMigration(
            mapOf(
                "host" to "100.64.0.10",
                "port" to "37891",
                "token" to "secret-token",
                "autoSendShared" to true,
                "unrelated" to "leave-alone",
            ),
        )

        assertEquals("secret-token", result.migratedValues["token"])
        assertEquals(true, result.migratedValues["autoSendShared"])
        assertFalse(result.migratedValues.containsKey("unrelated"))
        assertEquals(setOf("host", "port", "token", "autoSendShared"), result.keysToRemove)
    }
}
