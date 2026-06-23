package com.pragmaticcoder.piremote

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

internal const val LEGACY_PREFS_NAME = "pi-remote"
internal const val SECURE_PREFS_NAME = "pi-remote-secure"
internal const val MIGRATION_COPIED_MARKER = "plaintextMigrationCopied"
internal const val MIGRATION_CLEANUP_MARKER = "plaintextMigrationComplete"
internal val CONNECTION_PREF_KEYS = setOf("host", "port", "token", "autoSendShared", "keepAwake")

data class PreferenceMigrationResult(
    val migratedValues: Map<String, Any?>,
    val keysToRemove: Set<String>,
)

fun planPlaintextPreferenceMigration(legacyValues: Map<String, *>): PreferenceMigrationResult {
    val migrated = legacyValues
        .filterKeys { it in CONNECTION_PREF_KEYS }
        .filterValues { it is String || it is Boolean }
    return PreferenceMigrationResult(migrated, migrated.keys)
}

fun securePiRemotePreferences(context: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    val secure = EncryptedSharedPreferences.create(
        context,
        SECURE_PREFS_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    migratePlaintextPreferences(context.getSharedPreferences(LEGACY_PREFS_NAME, Context.MODE_PRIVATE), secure)
    return secure
}

private fun migratePlaintextPreferences(legacy: SharedPreferences, secure: SharedPreferences) {
    if (secure.getBoolean(MIGRATION_CLEANUP_MARKER, false)) return
    val plan = planPlaintextPreferenceMigration(legacy.all)

    if (!secure.getBoolean(MIGRATION_COPIED_MARKER, false)) {
        val secureCommitted = secure.edit().apply {
            for ((key, value) in plan.migratedValues) {
                when (value) {
                    is String -> putString(key, value)
                    is Boolean -> putBoolean(key, value)
                }
            }
            putBoolean(MIGRATION_COPIED_MARKER, true)
        }.commit()
        if (!secureCommitted) return
    }

    val legacyRemoved = legacy.edit().apply {
        for (key in plan.keysToRemove) remove(key)
    }.commit()
    if (!legacyRemoved) return

    secure.edit().putBoolean(MIGRATION_CLEANUP_MARKER, true).commit()
}
