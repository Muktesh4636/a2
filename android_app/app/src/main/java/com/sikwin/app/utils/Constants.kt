package com.sikwin.app.utils

object Constants {
    // Direct to load balancer — bypasses Cloudflare (gunduata.club returns 522 while CF origin is misconfigured)
    const val API_HOST = "http://gunduata.tech"
    const val BASE_URL = "$API_HOST/api/"
    const val WS_URL = "ws://gunduata.tech/ws/game/"

    /** HTTPS origin for casino + web games (WebView). */
    const val WEB_ORIGIN = "https://gunduata.tech"
    const val CASINO_PATH = "/casino/?v=20260818"
    const val GUNDU_ATA_PATH = "/game/"
    const val CASINO_URL = "$WEB_ORIGIN$CASINO_PATH"
    const val GUNDU_ATA_WEB_URL = "$WEB_ORIGIN$GUNDU_ATA_PATH"
}
