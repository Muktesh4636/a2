package com.pride.phonepemonitor

import android.content.Context
import android.provider.Settings
import android.text.TextUtils
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

object Prefs {
    private const val NAME = "phonepe_web_monitor"
    const val DEFAULT_SERVER_URL = "https://gunduata.tech"
    const val DEFAULT_WEB_URL = "https://gunduata.tech/api/phonepe-monitor/"
    // Filled after staff login via /api/companion/login/
    const val DEFAULT_SYNC_TOKEN = ""

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun serverUrl(ctx: Context): String =
        (prefs(ctx).getString("server_url", DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL)
            .trim().trimEnd('/')

    fun webUrl(ctx: Context): String {
        val saved = prefs(ctx).getString("web_url", null)
        if (!saved.isNullOrBlank()) return saved.trim()
        return serverUrl(ctx) + "/api/phonepe-monitor/"
    }

    fun syncToken(ctx: Context): String =
        prefs(ctx).getString("sync_token", "")?.trim().orEmpty()

    fun accessToken(ctx: Context): String =
        prefs(ctx).getString("access_token", "")?.trim().orEmpty()

    fun userJson(ctx: Context): String =
        prefs(ctx).getString("user_json", "")?.trim().orEmpty()

    fun isLoggedIn(ctx: Context): Boolean =
        accessToken(ctx).isNotBlank() || syncToken(ctx).isNotBlank()

    fun saveSession(ctx: Context, access: String, syncToken: String, userJson: String) {
        prefs(ctx).edit()
            .putString("access_token", access.trim())
            .putString("sync_token", syncToken.trim())
            .putString("user_json", userJson.trim())
            .apply()
    }

    fun clearSession(ctx: Context) {
        prefs(ctx).edit()
            .remove("access_token")
            .remove("sync_token")
            .remove("user_json")
            .putBoolean("monitor_enabled", false)
            // Next login does a full today+yesterday catch-up again
            .putBoolean("initial_full_sync_done", false)
            .apply()
    }

    /**
     * First successful sync after install/login pulls ALL today + yesterday credits.
     * Later checks only upload latest rows not yet recorded on this device.
     */
    fun initialFullSyncDone(ctx: Context): Boolean =
        prefs(ctx).getBoolean("initial_full_sync_done", false)

    fun setInitialFullSyncDone(ctx: Context, done: Boolean) {
        prefs(ctx).edit().putBoolean("initial_full_sync_done", done).apply()
    }

    /** Ensure defaults exist (server URL + device id). Sync token comes from login. */
    fun ensureDefaults(ctx: Context) {
        val p = prefs(ctx)
        val e = p.edit()
        if (p.getString("server_url", null).isNullOrBlank()) {
            e.putString("server_url", DEFAULT_SERVER_URL)
        }
        e.apply()
        deviceId(ctx)
    }
    fun deviceId(ctx: Context): String {
        var id = prefs(ctx).getString("device_id", null)
        if (id.isNullOrBlank()) {
            id = "webmon-" + UUID.randomUUID().toString().take(8)
            prefs(ctx).edit().putString("device_id", id).apply()
        }
        return id
    }

    fun saveConfig(ctx: Context, serverUrl: String, syncToken: String, webUrl: String? = null) {
        val e = prefs(ctx).edit()
            .putString("server_url", serverUrl.trim().trimEnd('/'))
            .putString("sync_token", syncToken.trim())
        if (!webUrl.isNullOrBlank()) {
            e.putString("web_url", webUrl.trim())
        }
        e.apply()
    }

    fun monitorEnabled(ctx: Context): Boolean =
        prefs(ctx).getBoolean("monitor_enabled", false)

    fun setMonitorEnabled(ctx: Context, enabled: Boolean) {
        prefs(ctx).edit().putBoolean("monitor_enabled", enabled).apply()
    }

    fun lastStatus(ctx: Context): String =
        prefs(ctx).getString("last_status", "Idle") ?: "Idle"

    fun setLastStatus(ctx: Context, status: String) {
        prefs(ctx).edit()
            .putString("last_status", status)
            .putLong("last_status_at", System.currentTimeMillis())
            .apply()
    }

    fun lastStatusAt(ctx: Context): Long =
        prefs(ctx).getLong("last_status_at", 0L)

    fun lastCheckAt(ctx: Context): Long =
        prefs(ctx).getLong("last_check_at", 0L)

    fun setLastCheckAt(ctx: Context, at: Long) {
        prefs(ctx).edit().putLong("last_check_at", at).apply()
    }

    fun seenFingerprints(ctx: Context): MutableSet<String> =
        prefs(ctx).getStringSet("seen_fps", emptySet())?.toMutableSet() ?: mutableSetOf()

    fun markSeen(ctx: Context, fingerprints: Collection<String>) {
        val set = seenFingerprints(ctx)
        set.addAll(fingerprints)
        // Cap growth
        val trimmed = if (set.size > 800) set.toList().takeLast(500).toMutableSet() else set
        prefs(ctx).edit().putStringSet("seen_fps", trimmed).apply()
    }

    fun isAccessibilityEnabled(ctx: Context): Boolean {
        val expected = "${ctx.packageName}/${PhonePeReaderService::class.java.canonicalName}"
        val enabled = Settings.Secure.getString(
            ctx.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        while (splitter.hasNext()) {
            if (splitter.next().equals(expected, ignoreCase = true)) return true
        }
        return false
    }
}

object MonitorSyncClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun upload(ctx: Context, details: List<TxnDetail>): String {
        val base = Prefs.serverUrl(ctx)
        val token = Prefs.syncToken(ctx)
        val access = Prefs.accessToken(ctx)
        if (token.isBlank() && access.isBlank()) {
            throw IllegalStateException("Login required before sync.")
        }

        val arr = JSONArray()
        details.forEach { arr.put(it.toJsonObject()) }
        val bodyJson = JSONObject()
            .put("device_id", Prefs.deviceId(ctx))
            .put("sync_token", token)
            .put("transactions", arr)
            .put("source", "phonepe_web_monitor")
        val body = bodyJson.toString().toRequestBody("application/json".toMediaType())

        val candidates = listOf(
            "$base/api/sync/",
            "$base/api/sync",
            "$base/api/auto-deposit/phonepe-sync/",
        )
        var lastError = "Sync failed"
        for (url in candidates) {
            val b = Request.Builder()
                .url(url)
                .header("Content-Type", "application/json")
                .post(body)
            if (token.isNotBlank()) b.header("X-Sync-Token", token)
            if (access.isNotBlank()) b.header("Authorization", "Bearer $access")
            client.newCall(b.build()).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (resp.isSuccessful) return text
                lastError = "Sync failed (${resp.code}) $url: $text"
                if (resp.code != 404) throw IllegalStateException(lastError)
            }
        }
        throw IllegalStateException(lastError)
    }

    fun postHeartbeat(ctx: Context) {
        val base = Prefs.serverUrl(ctx)
        val token = Prefs.syncToken(ctx)
        val access = Prefs.accessToken(ctx)
        if (token.isBlank() && access.isBlank()) return
        val body = JSONObject()
            .put("device_id", Prefs.deviceId(ctx))
            .put("sync_token", token)
            .put("version", "web-monitor-1.5.0")
            .toString()
            .toRequestBody("application/json".toMediaType())
        val b = Request.Builder()
            .url("$base/api/auto-deposit/heartbeat/")
            .header("Content-Type", "application/json")
            .post(body)
        if (token.isNotBlank()) b.header("X-Sync-Token", token)
        if (access.isNotBlank()) b.header("Authorization", "Bearer $access")
        client.newCall(b.build()).execute().use { }
    }
}
