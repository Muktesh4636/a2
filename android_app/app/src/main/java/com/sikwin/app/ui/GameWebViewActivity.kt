package com.sikwin.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.sikwin.app.MainActivity
import com.sikwin.app.data.auth.SessionManager
import com.sikwin.app.utils.Constants

/**
 * Full-screen WebView for casino + web games (Gundu Ata WebGL, roulette, trading, etc.).
 * Same JWT pattern: https://gunduata.tech/<game>/?token=<access>&refresh=<refresh>
 *
 * JS bridge (window.AndroidBridge):
 *  - goBack()
 *  - openGame(id, url)
 *  - openDeposit(url?)
 */
class GameWebViewActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var startUrl: String = Constants.CASINO_URL

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep status bar (time/battery) visible — do not draw WebView under it.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        startUrl = intent.getStringExtra(EXTRA_URL)?.takeIf { it.isNotBlank() }
            ?: buildUrlWithTokens(Constants.CASINO_PATH)

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.databaseEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.userAgentString = settings.userAgentString + " GunduAtaApp/1.0"
            settings.allowFileAccess = true
            settings.javaScriptCanOpenWindowsAutomatically = false

            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    return handleExternalOrKeep(request?.url?.toString().orEmpty())
                }

                @Deprecated("Deprecated in Java")
                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                    return handleExternalOrKeep(url.orEmpty())
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    // Tell pages Android already cleared the status bar area.
                    view?.evaluateJavascript(
                        """
                        (function(){
                          try {
                            document.documentElement.classList.add('android-system-bars');
                            document.body && document.body.classList.add('in-app','android-system-bars');
                            if (window.applyGameTopInset) window.applyGameTopInset();
                          } catch (e) {}
                        })();
                        """.trimIndent(),
                        null
                    )
                }
            }
        }

        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(webView)
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                handleBack()
            }
        })

        Log.d(TAG, "Loading $startUrl")
        webView.loadUrl(startUrl)
    }

    private fun handleExternalOrKeep(url: String): Boolean {
        if (url.isBlank()) return false
        if (url.contains("gunduata.tech") || url.contains("gunduata.com") || url.startsWith("file:")) {
            return false
        }
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            true
        } catch (e: Exception) {
            Log.w(TAG, "External open failed: $url", e)
            false
        }
    }

    private fun handleBack() {
        val current = webView.url.orEmpty()
        when {
            webView.canGoBack() && !isLobbyUrl(current) -> webView.goBack()
            isLobbyUrl(current) -> finishToHome()
            else -> webView.loadUrl(buildUrlWithTokens(Constants.CASINO_PATH))
        }
    }

    private fun isLobbyUrl(url: String): Boolean {
        return url.contains("/casino")
    }

    private fun finishToHome() {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra("redirect", "home")
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        startActivity(intent)
        finish()
    }

    private fun session(): SessionManager = SessionManager(this)

    private fun buildUrlWithTokens(path: String): String {
        val access = intent.getStringExtra(EXTRA_TOKEN) ?: session().fetchAuthToken() ?: ""
        val refresh = intent.getStringExtra(EXTRA_REFRESH) ?: session().fetchRefreshToken() ?: ""
        return companionBuildUrl(path, access, refresh)
    }

    private fun ensureTokenOnUrl(url: String): String {
        val access = intent.getStringExtra(EXTRA_TOKEN) ?: session().fetchAuthToken() ?: ""
        val refresh = intent.getStringExtra(EXTRA_REFRESH) ?: session().fetchRefreshToken() ?: ""
        val parsed = Uri.parse(url)
        val uri = parsed.buildUpon()
        if (access.isNotBlank() && parsed.getQueryParameter("token").isNullOrBlank()) {
            uri.appendQueryParameter("token", access)
        }
        if (refresh.isNotBlank() && parsed.getQueryParameter("refresh").isNullOrBlank()) {
            uri.appendQueryParameter("refresh", refresh)
        }
        return uri.build().toString()
    }

    private fun pathForGameId(id: String): String = when (id) {
        "gundu-ata", "gundu_ata", "dice" -> Constants.GUNDU_ATA_PATH
        "stock-market", "trading" -> "/trading/"
        "auto-roulette", "roulette" -> "/roulette/"
        "chicken-road" -> "/chicken-road/"
        "chicken-road-2" -> "/chicken-road-2/"
        "vortex" -> "/vortex/"
        "chit-pat" -> "/chit-pat/"
        "rangu" -> "/rangu/"
        "casino" -> Constants.CASINO_PATH
        else -> Constants.CASINO_PATH
    }

    override fun onDestroy() {
        try {
            webView.stopLoading()
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.destroy()
        } catch (_: Exception) {
        }
        super.onDestroy()
    }

    inner class AndroidBridge {
        @JavascriptInterface
        fun goBack() {
            runOnUiThread { handleBack() }
        }

        @JavascriptInterface
        fun openGame(gameId: String?, url: String?) {
            runOnUiThread {
                val target = when {
                    !url.isNullOrBlank() -> ensureTokenOnUrl(url)
                    !gameId.isNullOrBlank() -> buildUrlWithTokens(pathForGameId(gameId))
                    else -> return@runOnUiThread
                }
                Log.d(TAG, "openGame id=$gameId url=$target")
                webView.loadUrl(target)
            }
        }

        @JavascriptInterface
        fun openDeposit(url: String?) {
            runOnUiThread {
                val target = if (!url.isNullOrBlank()) {
                    ensureTokenOnUrl(url)
                } else {
                    buildUrlWithTokens("/deposit")
                }
                webView.loadUrl(target)
            }
        }

        /** True when WebView content is already padded below the status bar. */
        @JavascriptInterface
        fun isSystemBarsInsetApplied(): Boolean = true

        @JavascriptInterface
        fun getStatusBarHeightPx(): Int {
            val resId = resources.getIdentifier("status_bar_height", "dimen", "android")
            return if (resId > 0) resources.getDimensionPixelSize(resId)
            else (28 * resources.displayMetrics.density).toInt()
        }
    }

    companion object {
        private const val TAG = "GameWebView"
        const val EXTRA_URL = "url"
        const val EXTRA_TOKEN = "token"
        const val EXTRA_REFRESH = "refresh"

        fun companionBuildUrl(path: String, access: String?, refresh: String?): String {
            val base = if (path.startsWith("http")) path else Constants.WEB_ORIGIN.trimEnd('/') + path
            val uri = Uri.parse(base).buildUpon()
            if (!access.isNullOrBlank()) uri.appendQueryParameter("token", access)
            if (!refresh.isNullOrBlank()) uri.appendQueryParameter("refresh", refresh)
            return uri.build().toString()
        }

        fun buildGameUrl(path: String, access: String?, refresh: String?): String =
            companionBuildUrl(path, access, refresh)
    }
}
