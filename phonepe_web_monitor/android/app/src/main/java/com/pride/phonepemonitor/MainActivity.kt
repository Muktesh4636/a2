package com.pride.phonepemonitor

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var promptedAccessibility = false

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                MinuteMonitorService.ACTION_STATUS -> {
                    val msg = intent.getStringExtra(MinuteMonitorService.EXTRA_STATUS) ?: return
                    pushEvent("status", JSONObject().put("message", msg))
                }
                MinuteMonitorService.ACTION_NEED_ACCESSIBILITY -> {
                    openAccessibilitySettings(force = true)
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.ensureDefaults(this)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.userAgentString = settings.userAgentString + " PhonePeWebMonitor/1.1"

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                pushEvent("ready", statusJson())
            }
        }

        webView.addJavascriptInterface(WebBridge(this), "PhonePeMonitor")
        webView.loadUrl(Prefs.webUrl(this))

        // Only auto-start monitor after staff login
        if (Prefs.isLoggedIn(this) && Prefs.monitorEnabled(this)) {
            MinuteMonitorService.start(this)
        }
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter().apply {
            addAction(MinuteMonitorService.ACTION_STATUS)
            addAction(MinuteMonitorService.ACTION_NEED_ACCESSIBILITY)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, filter)
        }
    }

    override fun onStop() {
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
        }
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        Prefs.ensureDefaults(this)
        if (Prefs.isLoggedIn(this) && Prefs.monitorEnabled(this)) {
            MinuteMonitorService.start(this)
            if (Prefs.isAccessibilityEnabled(this)) {
                MinuteMonitorService.forceCheck(this)
            } else {
                openAccessibilitySettings(force = false)
            }
        }
        pushEvent("resume", statusJson())
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    fun openAccessibilitySettings(force: Boolean) {
        if (Prefs.isAccessibilityEnabled(this)) return
        if (!force && promptedAccessibility) return
        promptedAccessibility = true
        Toast.makeText(
            this,
            "Enable: Accessibility → Installed apps → PhonePe Web Monitor",
            Toast.LENGTH_LONG
        ).show()
        try {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        } catch (_: Exception) {
        }
    }

    fun statusJson(): JSONObject = JSONObject()
        .put("serverUrl", Prefs.serverUrl(this))
        .put("webUrl", Prefs.webUrl(this))
        .put("syncToken", Prefs.syncToken(this))
        .put("accessToken", Prefs.accessToken(this))
        .put("userJson", Prefs.userJson(this))
        .put("loggedIn", Prefs.isLoggedIn(this))
        .put("deviceId", Prefs.deviceId(this))
        .put("monitorEnabled", Prefs.monitorEnabled(this))
        .put("accessibilityEnabled", Prefs.isAccessibilityEnabled(this))
        .put("lastStatus", Prefs.lastStatus(this))
        .put("lastStatusAt", Prefs.lastStatusAt(this))
        .put("lastCheckAt", Prefs.lastCheckAt(this))
        .put("appVersion", BuildConfig.VERSION_NAME)

    fun pushEvent(name: String, payload: JSONObject) {
        val js = "window.onPhonePeMonitorEvent && window.onPhonePeMonitorEvent(${JSONObject.quote(name)}, $payload);"
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }

    fun reloadFromWeb() {
        webView.loadUrl(Prefs.webUrl(this))
    }

    class WebBridge(private val activity: MainActivity) {
        @JavascriptInterface
        fun getStatus(): String = activity.statusJson().toString()

        @JavascriptInterface
        fun saveConfig(serverUrl: String?, syncToken: String?, webUrl: String?) {
            activity.runOnUiThread {
                Prefs.saveConfig(
                    activity,
                    serverUrl?.ifBlank { Prefs.serverUrl(activity) } ?: Prefs.serverUrl(activity),
                    syncToken?.ifBlank { Prefs.syncToken(activity) } ?: Prefs.syncToken(activity),
                    webUrl,
                )
                activity.pushEvent("configSaved", activity.statusJson())
            }
        }

        @JavascriptInterface
        fun saveSession(access: String?, syncToken: String?, userJson: String?) {
            activity.runOnUiThread {
                Prefs.saveSession(
                    activity,
                    access.orEmpty(),
                    syncToken.orEmpty(),
                    userJson.orEmpty(),
                )
                activity.pushEvent("sessionSaved", activity.statusJson())
            }
        }

        @JavascriptInterface
        fun clearSession() {
            activity.runOnUiThread {
                MinuteMonitorService.stop(activity)
                Prefs.clearSession(activity)
                activity.pushEvent("sessionCleared", activity.statusJson())
            }
        }

        @JavascriptInterface
        fun startMonitor() {
            activity.runOnUiThread {
                if (!Prefs.isLoggedIn(activity)) {
                    Prefs.setLastStatus(activity, "Login required")
                    activity.pushEvent("status", JSONObject().put("message", "Login required"))
                    return@runOnUiThread
                }
                Prefs.ensureDefaults(activity)
                Prefs.setMonitorEnabled(activity, true)
                if (!Prefs.isAccessibilityEnabled(activity)) {
                    activity.openAccessibilitySettings(force = true)
                }
                MinuteMonitorService.start(activity)
                MinuteMonitorService.forceCheck(activity)
                activity.pushEvent("monitorStarted", activity.statusJson())
            }
        }

        @JavascriptInterface
        fun stopMonitor() {
            activity.runOnUiThread {
                MinuteMonitorService.stop(activity)
                activity.pushEvent("monitorStopped", activity.statusJson())
            }
        }

        @JavascriptInterface
        fun checkNow() {
            activity.runOnUiThread {
                Prefs.ensureDefaults(activity)
                if (!Prefs.isAccessibilityEnabled(activity)) {
                    activity.openAccessibilitySettings(force = true)
                    return@runOnUiThread
                }
                MinuteMonitorService.forceCheck(activity)
                activity.pushEvent("checkNow", activity.statusJson())
            }
        }

        @JavascriptInterface
        fun openAccessibility() {
            activity.runOnUiThread {
                activity.openAccessibilitySettings(force = true)
            }
        }

        @JavascriptInterface
        fun reloadWeb() {
            activity.runOnUiThread {
                activity.reloadFromWeb()
            }
        }
    }
}
