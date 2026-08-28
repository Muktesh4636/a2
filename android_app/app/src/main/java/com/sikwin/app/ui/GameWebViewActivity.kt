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
 *  - goHome()
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

    private fun stopWebAudio() {
        try {
            webView.evaluateJavascript(
                """
                (function(){
                  try{ if(window.stopGameAudio) window.stopGameAudio(); }catch(e){}
                  try{
                    if(typeof WEBAudio!=='undefined' && WEBAudio && WEBAudio.audioContext){
                      try{ WEBAudio.audioContext.suspend(); }catch(e1){}
                      try{ WEBAudio.audioContext.close(); }catch(e2){}
                    }
                  }catch(e3){}
                  try{
                    var a=document.querySelectorAll('audio');
                    for(var i=0;i<a.length;i++){ try{ a[i].pause(); a[i].src=''; }catch(e4){} }
                  }catch(e5){}
                })();
                """.trimIndent(),
                null
            )
        } catch (_: Exception) {
        }
    }

    private fun handleBack() {
        val current = webView.url.orEmpty()
        if (current.contains("/game")) stopWebAudio()
        // Casino lobby → app home.
        if (isLobbyUrl(current)) {
            finishToHome()
            return
        }
        // Opened from site/app home (?from=home) → native home in one back.
        if (current.contains("/game") && current.contains("from=home")) {
            finishToHome()
            return
        }
        // Opened from casino (?from=casino) → WebView back to casino.
        if (webView.canGoBack()) {
            webView.goBack()
            return
        }
        if (current.contains("/game")) {
            webView.loadUrl(buildUrlWithTokens(Constants.CASINO_PATH))
            return
        }
        webView.loadUrl(buildUrlWithTokens(Constants.CASINO_PATH))
    }

    private fun isLobbyUrl(url: String): Boolean {
        return url.contains("/casino")
    }

    private fun finishToHome() {
        stopWebAudio()
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
        "live-roulette", "auto-roulette", "roulette" -> "/roulette/"
        "chicken-road" -> "/chicken-road/"
        "chicken-road-2" -> "/chicken-road-2/"
        "vortex" -> "/vortex/"
        "vortex-1", "vortex1", "vortex_1" -> "/vortex-1/"
        "vortex-2", "vortex2", "vortex_2" -> "/vortex-2/"
        "vip-vortex", "vip_vortex", "vipvortex" -> "/vip-vortex/"
        "mines" -> "/mines/"
        "steps" -> "/steps/"
        "boxes" -> "/boxes/"
        "snake" -> "/snake/"
        "slide" -> "/slide/"
        "cases" -> "/cases/"
        "drop" -> "/drop/"
        "plinko" -> "/plinko/"
        "air-balloon", "air_balloon", "air-ballon-pump" -> "/air-balloon/"
        "chit-pat" -> "/chit-pat/"
        "rangu" -> "/rangu/"
        "circle-game", "circle_game" -> "/circle-game/"
        "stop-bar", "stop_bar" -> "/stop-bar/"
        "spin-dial", "spin_dial" -> "/spin-dial/"
        "mines-path", "mines_path" -> "/mines-path/"
        "dice-over-under", "dice_over_under" -> "/dice-over-under/"
        "color-match", "color_match" -> "/color-match/"
        "wheel-pockets", "wheel_pockets" -> "/wheel-pockets/"
        "wave-surf", "wave_surf" -> "/wave-surf/"
        "keno-pick", "keno_pick" -> "/keno-pick/"
        "hi-lo-cards", "hi_lo_cards", "hilo-cards" -> "/hi-lo-cards/"
        "aviator" -> "/aviator/"
        "jet" -> "/jet/"
        "maestro" -> "/maestro/"
        "deep-dive", "deep_dive" -> "/deep-dive/"
        "sky-lift", "sky_lift" -> "/sky-lift/"
        "paper-plane", "paper_plane" -> "/paper-plane/"
        "ufo-lift", "ufo_lift" -> "/ufo-lift/"
        "shark-bite", "shark_bite", "aviator-wave-surf" -> "/shark-bite/"
        "under-6", "under_6", "under6" -> "/under-6/"
        "rushbet", "rush-bet" -> "/rushbet/"
        "knock6", "knock-6" -> "/knock6/"
        "tripleedge", "triple-edge" -> "/tripleedge/"
        "mirror" -> "/mirror/"
        "goldlane", "gold-lane" -> "/goldlane/"
        "dead7", "dead-7" -> "/dead7/"
        "teenpatti", "teen-patti" -> "/teenpatti/"
        "horse-racing", "horse_racing", "horseracing", "gallop" -> "/horse-racing/"
        "casino" -> Constants.CASINO_PATH
        // New website games: open /{id}/ so lobby tiles work without an APK map update.
        // Never fall back to casino here — that reloads the lobby after the user already opened it.
        else -> "/${id.trim().trim('/')}/"
    }

    override fun onPause() {
        stopWebAudio()
        try { webView.onPause() } catch (_: Exception) {}
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        try { webView.onResume() } catch (_: Exception) {}
    }

    override fun onDestroy() {
        stopWebAudio()
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
        fun goHome() {
            runOnUiThread { finishToHome() }
        }

        @JavascriptInterface
        fun openGame(gameId: String?, url: String?) {
            // Prefer URL from the website (games.js path → full URL).
            // That means new lobby games need no APK update — only a site redeploy.
            // pathForGameId is fallback when url is blank (deep links / old callers).
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
