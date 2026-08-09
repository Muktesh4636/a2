package com.svspay.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * SVS Pay — WebView shell. Login required for every staff account.
 * UI: https://gunduata.tech/api/svs-pay/
 *
 * Back / swipe-back: navigate inside the app (tabs / WebView history),
 * then minimize to background — do not close the app.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Prefs.ensureDefaults(this)
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.userAgentString = settings.userAgentString + " SvsPay/" + BuildConfig.VERSION_NAME

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false
        }
        webView.addJavascriptInterface(Bridge(this), "SvsPay")
        webView.loadUrl(Prefs.webUrl(this))

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    handleAppBack()
                }
            },
        )
    }

    private fun handleAppBack() {
        // 1) Let the web UI handle tab / password-box back first
        webView.evaluateJavascript("window.__svsPayHandleBack ? window.__svsPayHandleBack() : false") { result ->
            runOnUiThread {
                val handled = result == "true" || result == "\"true\""
                if (handled) return@runOnUiThread
                // 2) WebView page history
                if (webView.canGoBack()) {
                    webView.goBack()
                    return@runOnUiThread
                }
                // 3) Minimize — do not finish/close the app
                moveTaskToBack(true)
            }
        }
    }

    class Bridge(private val activity: MainActivity) {
        @JavascriptInterface
        fun getConfig(): String = JSONObject()
            .put("serverUrl", Prefs.serverUrl(activity))
            .put("webUrl", Prefs.webUrl(activity))
            .put("syncToken", Prefs.syncToken(activity))
            .put("access", Prefs.accessToken(activity))
            .put("userJson", Prefs.userJson(activity))
            .put("appVersion", BuildConfig.VERSION_NAME)
            .toString()

        @JavascriptInterface
        fun getServerUrl(): String = Prefs.serverUrl(activity)

        @JavascriptInterface
        fun saveSession(access: String?, syncToken: String?, userJson: String?) {
            activity.runOnUiThread {
                Prefs.saveSession(
                    activity,
                    access.orEmpty(),
                    syncToken.orEmpty(),
                    userJson.orEmpty(),
                )
            }
        }

        @JavascriptInterface
        fun clearSession() {
            activity.runOnUiThread {
                Prefs.clearSession(activity)
            }
        }

        @JavascriptInterface
        fun saveConfig(syncToken: String?) {
            activity.runOnUiThread {
                if (!syncToken.isNullOrBlank()) {
                    Prefs.saveSession(activity, Prefs.accessToken(activity), syncToken, Prefs.userJson(activity))
                }
            }
        }

        @JavascriptInterface
        fun reload() {
            activity.runOnUiThread {
                activity.webView.loadUrl(Prefs.webUrl(activity))
            }
        }

        /** Called from web if it wants the Android shell to minimize instead of closing. */
        @JavascriptInterface
        fun moveToBackground() {
            activity.runOnUiThread {
                activity.moveTaskToBack(true)
            }
        }
    }
}
