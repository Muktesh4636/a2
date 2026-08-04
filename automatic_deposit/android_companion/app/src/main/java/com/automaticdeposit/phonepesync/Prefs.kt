package com.automaticdeposit.phonepesync

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
    private const val NAME = "phonepe_sync"
    // Production game API — companion posts PhonePe txns to /api/sync/
    const val DEFAULT_SERVER_URL = "https://gunduata.tech"
    // Prefill so install works; rotate token in Admin Profile if compromised
    const val DEFAULT_SYNC_TOKEN = "Aj8cgnLkoFtFMFumCIL5zd568L3z4dSl"

    fun serverUrl(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        var url = prefs.getString("server_url", DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        // Migrate old local Flask URLs to production game API
        val normalized = url.trim().trimEnd('/')
        if (
            normalized.contains("192.168.") ||
            normalized.contains("127.0.0.1") ||
            normalized.contains("10.0.") ||
            normalized.endsWith(":5055")
        ) {
            url = DEFAULT_SERVER_URL
            prefs.edit().putString("server_url", url).apply()
        }
        return url.trim().trimEnd('/')
    }

    fun syncToken(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        var saved = prefs.getString("sync_token", null)
        if (saved.isNullOrBlank()) {
            saved = DEFAULT_SYNC_TOKEN
            prefs.edit().putString("sync_token", saved).apply()
        }
        return saved
    }

    fun deviceId(ctx: Context): String {
        val prefs = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)
        var id = prefs.getString("device_id", null)
        if (id.isNullOrBlank()) {
            id = "android-" + UUID.randomUUID().toString().take(8)
            prefs.edit().putString("device_id", id).apply()
        }
        return id
    }

    fun save(ctx: Context, serverUrl: String, syncToken: String) {
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putString("server_url", serverUrl.trim().trimEnd('/'))
            .putString("sync_token", syncToken.trim())
            .apply()
    }

    fun autoWatchEnabled(ctx: Context): Boolean =
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).getBoolean("auto_watch", true)

    fun setAutoWatch(ctx: Context, enabled: Boolean) {
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putBoolean("auto_watch", enabled)
            .apply()
    }

    fun lastSeenPendingId(ctx: Context): Long =
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).getLong("last_pending_id", 0L)

    fun setLastSeenPendingId(ctx: Context, id: Long) {
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putLong("last_pending_id", id)
            .apply()
    }

    fun lastAutoFetchAt(ctx: Context): Long =
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).getLong("last_auto_fetch_at", 0L)

    fun setLastAutoFetchAt(ctx: Context, at: Long) {
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE).edit()
            .putLong("last_auto_fetch_at", at)
            .apply()
    }

    fun isAccessibilityEnabled(ctx: Context): Boolean {
        val expected = "${ctx.packageName}/${PhonePeAccessibilityService::class.java.canonicalName}"
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

object SyncClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    fun upload(ctx: Context, details: List<TxnDetail>): String {
        val base = Prefs.serverUrl(ctx).trim().trimEnd('/')
        val token = Prefs.syncToken(ctx)
        if (token.isBlank()) throw IllegalStateException("Sync token missing. Paste it from Admin Profile.")

        val arr = JSONArray()
        details.forEach { arr.put(it.toJsonObject()) }
        val bodyJson = JSONObject()
            .put("device_id", Prefs.deviceId(ctx))
            .put("sync_token", token)
            .put("transactions", arr)
        val body = bodyJson.toString().toRequestBody("application/json".toMediaType())

        // Prefer /api/sync/ (Django), fall back to /api/auto-deposit/phonepe-sync/
        val candidates = listOf(
            "$base/api/sync/",
            "$base/api/sync",
            "$base/api/auto-deposit/phonepe-sync/",
        )
        var lastError = "Sync failed"
        for (url in candidates) {
            val req = Request.Builder()
                .url(url)
                .header("X-Sync-Token", token)
                .header("Content-Type", "application/json")
                .post(body)
                .build()
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (resp.isSuccessful) return text
                lastError = "Sync failed (${resp.code}) $url: $text"
                // Try next path on 404 only
                if (resp.code != 404) throw IllegalStateException(lastError)
            }
        }
        throw IllegalStateException(lastError)
    }

    fun fetchPendingTrigger(ctx: Context): JSONObject {
        val base = Prefs.serverUrl(ctx).trim().trimEnd('/')
        val token = Prefs.syncToken(ctx)
        if (token.isBlank()) throw IllegalStateException("Sync token missing")
        val url = "$base/api/auto-deposit/pending-trigger/"
        val req = Request.Builder()
            .url(url)
            .header("X-Sync-Token", token)
            .get()
            .build()
        client.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            if (!resp.isSuccessful) {
                throw IllegalStateException("Pending check failed (${resp.code}): $text")
            }
            return JSONObject(text.ifBlank { "{}" })
        }
    }

    fun postHeartbeat(ctx: Context) {
        val base = Prefs.serverUrl(ctx).trim().trimEnd('/')
        val token = Prefs.syncToken(ctx)
        if (token.isBlank()) return
        val body = JSONObject()
            .put("device_id", Prefs.deviceId(ctx))
            .put("sync_token", token)
            .put("version", "1.4.0")
            .toString()
            .toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("$base/api/auto-deposit/heartbeat/")
            .header("X-Sync-Token", token)
            .post(body)
            .build()
        client.newCall(req).execute().use { }
    }
}
