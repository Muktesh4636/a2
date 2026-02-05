package com.sikwin.app.data.auth

import android.content.Context
import android.content.SharedPreferences

class SessionManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("gunduata_prefs", Context.MODE_PRIVATE)

    companion object {
        private const val USER_TOKEN = "user_token"
        private const val REFRESH_TOKEN = "refresh_token"
        private const val USERNAME = "username"
    }

    fun saveAuthToken(token: String) {
        prefs.edit().putString(USER_TOKEN, token).apply()
    }

    fun fetchAuthToken(): String? {
        return prefs.getString(USER_TOKEN, null)
    }

    fun saveRefreshToken(token: String) {
        prefs.edit().putString(REFRESH_TOKEN, token).apply()
    }

    fun fetchRefreshToken(): String? {
        return prefs.getString(REFRESH_TOKEN, null)
    }

    fun saveUsername(username: String) {
        prefs.edit().putString(USERNAME, username).apply()
    }

    fun fetchUsername(): String? {
        return prefs.getString(USERNAME, "User")
    }

    fun logout() {
        prefs.edit().clear().apply()
    }
}
