package com.svspay.app

import android.content.Context

object Prefs {
    private const val NAME = "svs_pay"
    const val DEFAULT_SERVER_URL = "https://gunduata.tech"
    const val DEFAULT_WEB_URL = "https://gunduata.tech/api/svs-pay/"

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun serverUrl(ctx: Context): String =
        (prefs(ctx).getString("server_url", DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL)
            .trim().trimEnd('/')

    fun webUrl(ctx: Context): String {
        val saved = prefs(ctx).getString("web_url", null)
        if (!saved.isNullOrBlank()) return saved.trim()
        return serverUrl(ctx) + "/api/svs-pay/"
    }

    fun syncToken(ctx: Context): String =
        prefs(ctx).getString("sync_token", "")?.trim().orEmpty()

    fun accessToken(ctx: Context): String =
        prefs(ctx).getString("access_token", "")?.trim().orEmpty()

    fun userJson(ctx: Context): String =
        prefs(ctx).getString("user_json", "")?.trim().orEmpty()

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
            .apply()
    }

    fun ensureDefaults(ctx: Context) {
        val p = prefs(ctx)
        if (p.getString("server_url", null).isNullOrBlank()) {
            p.edit().putString("server_url", DEFAULT_SERVER_URL).apply()
        }
    }
}
