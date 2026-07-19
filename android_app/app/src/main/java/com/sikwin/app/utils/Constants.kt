package com.sikwin.app.utils

object Constants {
    // Direct to load balancer — bypasses Cloudflare (gunduata.club returns 522 while CF origin is misconfigured)
    const val API_HOST = "http://gunduata.tech"
    const val BASE_URL = "$API_HOST/api/"
    const val WS_URL = "ws://gunduata.tech/ws/game/"
}
