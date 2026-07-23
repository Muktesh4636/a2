package com.pradyumna.roultee.web

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.webkit.MimeTypeMap
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

class WebRouletteActivity : Activity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this).apply {
            setBackgroundColor(Color.rgb(20, 8, 12))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            settings.setSupportZoom(false)
            webChromeClient = WebChromeClient()
            webViewClient = LocalAssetClient()
        }
        setContentView(webView)
        webView.loadUrl(APP_URL)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    private inner class LocalAssetClient : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?,
        ): WebResourceResponse? {
            val uri = request?.url ?: return null
            if (uri.scheme != "https" || uri.host != APP_HOST) return null

            val path = uri.path.orEmpty().removePrefix("/").ifEmpty { "index.html" }
            if (path.contains("..")) return notFound()

            return try {
                val stream = assets.open("web/$path")
                WebResourceResponse(mimeType(path), "UTF-8", stream).apply {
                    responseHeaders = mapOf(
                        "Access-Control-Allow-Origin" to "*",
                        "Cache-Control" to "no-cache",
                    )
                }
            } catch (_: Exception) {
                notFound()
            }
        }

        private fun notFound() = WebResourceResponse(
            "text/plain",
            "UTF-8",
            404,
            "Not Found",
            emptyMap(),
            ByteArrayInputStream("Not Found".toByteArray()),
        )

        private fun mimeType(path: String): String = when {
            path.endsWith(".js") -> "text/javascript"
            path.endsWith(".css") -> "text/css"
            path.endsWith(".html") -> "text/html"
            path.endsWith(".png") -> "image/png"
            else -> MimeTypeMap.getSingleton()
                .getMimeTypeFromExtension(path.substringAfterLast('.', ""))
                ?: "application/octet-stream"
        }
    }

    private companion object {
        const val APP_HOST = "roulette.local"
        const val APP_URL = "https://$APP_HOST/index.html"
    }
}
