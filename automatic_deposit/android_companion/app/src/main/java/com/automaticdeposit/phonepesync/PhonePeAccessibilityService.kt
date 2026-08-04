package com.automaticdeposit.phonepesync

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * On-device PhonePe History reader (replaces ADB uiautomator).
 * Opens PhonePe, taps History, opens each recent txn, extracts UTR, syncs to server.
 */
class PhonePeAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile var instance: PhonePeAccessibilityService? = null
        private val fetchLock = Any()
        @Volatile private var fetchRunning = false

        private val TYPE_LABELS = setOf(
            "Paid to", "Transfer to", "Received from", "Paid securely", "Money added"
        )
        /** Prefer credits when auto-fetching for deposits */
        private val CREDIT_LABELS = setOf("Received from", "Money added")

        fun fetchAndSync(
            limit: Int,
            pendingAmounts: List<String> = emptyList(),
            onStatus: (String) -> Unit,
            onDone: (Result<List<TxnDetail>>) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                onDone(Result.failure(IllegalStateException("Enable Accessibility for PhonePe Sync first.")))
                return
            }
            synchronized(fetchLock) {
                if (fetchRunning) {
                    onDone(Result.failure(IllegalStateException("PhonePe fetch already running.")))
                    return
                }
                fetchRunning = true
            }
            thread(name = "phonepe-fetch") {
                try {
                    onStatus("Opening PhonePe…")
                    val details = svc.collectWithDetails(limit, pendingAmounts, onStatus)
                    onStatus("Uploading ${details.size} txn(s) to server…")
                    SyncClient.upload(svc, details)
                    onDone(Result.success(details))
                } catch (t: Throwable) {
                    onDone(Result.failure(t))
                } finally {
                    fetchRunning = false
                }
            }
        }

        /**
         * Daily background sync: collects ALL today's credit transactions (scrolls until
         * "Yesterday" appears). Keeps server UTR log current so instant-match works.
         */
        fun syncAllTodayCredits(
            onStatus: (String) -> Unit,
            onDone: (Result<List<TxnDetail>>) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                onDone(Result.failure(IllegalStateException("Accessibility not enabled.")))
                return
            }
            synchronized(fetchLock) {
                if (fetchRunning) {
                    onDone(Result.failure(IllegalStateException("PhonePe fetch already running.")))
                    return
                }
                fetchRunning = true
            }
            thread(name = "phonepe-daily-sync") {
                try {
                    onStatus("Daily sync: opening PhonePe…")
                    val details = svc.collectAllTodayCredits(onStatus)
                    onStatus("Daily sync: uploading ${details.size} credit(s)…")
                    SyncClient.upload(svc, details)
                    onDone(Result.success(details))
                } catch (t: Throwable) {
                    onDone(Result.failure(t))
                } finally {
                    fetchRunning = false
                }
            }
        }
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    private fun collectWithDetails(
        limit: Int,
        pendingAmounts: List<String>,
        onStatus: (String) -> Unit,
    ): List<TxnDetail> {
        val capped = limit.coerceIn(1, 10)
        openPhonePe()
        sleep(2200)
        goToHistory()
        sleep(1500)
        // Pull-to-refresh so the latest txns appear
        onStatus("Refreshing PhonePe History…")
        pullToRefresh()
        sleep(2500)

        // Parse top rows; prefer credit rows (Received from / Money added)
        val allVisible = parseHistoryList(capped + 4)  // a few extra to find credits
        val creditRows = allVisible.filter {
            it.type in CREDIT_LABELS || it.amount.trimStart().startsWith("+")
        }

        // If we have pending amounts, pre-filter: only rows whose list-amount roughly matches
        val candidates = if (pendingAmounts.isNotEmpty()) {
            val matched = creditRows.filter { row ->
                pendingAmounts.any { pa -> amountsRoughlyMatch(row.amount, pa) }
            }.ifEmpty { creditRows }  // fall back to all credits if none match
            matched
        } else {
            creditRows
        }.ifEmpty { allVisible }  // last resort: all visible rows

        val summaries = candidates.take(capped).mapIndexed { i, s -> s.copy(index = i + 1) }

        if (summaries.isEmpty()) {
            throw IllegalStateException("No History rows found. Unlock PhonePe and open History once.")
        }
        onStatus("Checking ${summaries.size} txn(s) (credits only)…")

        val details = mutableListOf<TxnDetail>()
        for (summary in summaries) {
            onStatus("Reading #${summary.index} ${summary.party} ${summary.amount}…")
            openSummaryOnScreen(summary)
            sleep(2400)
            val d = parseDetail(summary.index)
            details += d.copy(
                type = d.type.ifBlank { summary.type },
                party = d.party.ifBlank { summary.party },
                amount = d.amount.ifBlank { summary.amount },
            )
            performGlobalAction(GLOBAL_ACTION_BACK)
            sleep(1200)
            if (!isHistoryScreen()) {
                goToHistory()
                sleep(1500)
            }
        }
        return details
    }

    /**
     * Collect ALL of today's credit transactions by scrolling History until "Yesterday" appears.
     * Opens each credit row to extract the full UTR. Caps at 40 transactions to avoid runaway.
     */
    private fun collectAllTodayCredits(onStatus: (String) -> Unit): List<TxnDetail> {
        openPhonePe()
        sleep(2200)
        goToHistory()
        sleep(1500)
        onStatus("Daily sync: refreshing PhonePe History…")
        pullToRefresh()
        sleep(2500)

        val seenKeys = mutableSetOf<String>()   // "type|party|amount" dedup
        val allDetails = mutableListOf<TxnDetail>()
        val MAX_TXNS = 40
        val MAX_SCROLLS = 8

        // DATE_STOP_LABELS: if any of these appear on screen we've passed today's txns
        val DATE_STOP_LABELS = setOf(
            "Yesterday", "2 days ago", "3 days ago",
        )
        // Also stop for explicit past-date patterns like "Aug 2" / "Aug 1" etc.

        var scrollsDone = 0
        outer@ while (scrollsDone <= MAX_SCROLLS && allDetails.size < MAX_TXNS) {
            val texts = collectTexts()

            // Check if we've scrolled past today
            if (texts.any { it in DATE_STOP_LABELS || isPastDateLabel(it) }) {
                onStatus("Daily sync: reached yesterday's entries, stopping.")
                break
            }

            val creditRows = parseHistoryList(20).filter {
                it.type in CREDIT_LABELS || it.amount.trimStart().startsWith("+")
            }

            var addedThisPage = 0
            for (row in creditRows) {
                val key = "${row.type}|${row.party}|${row.amount}"
                if (key in seenKeys) continue
                if (allDetails.size >= MAX_TXNS) break@outer
                seenKeys += key
                onStatus("Daily sync: reading ${row.party} ${row.amount}…")
                try {
                    openSummaryOnScreen(row)
                    sleep(2400)
                    val d = parseDetail(row.index)
                    allDetails += d.copy(
                        type = d.type.ifBlank { row.type },
                        party = d.party.ifBlank { row.party },
                        amount = d.amount.ifBlank { row.amount },
                    )
                    addedThisPage++
                } catch (e: Exception) {
                    // skip unreadable row
                } finally {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    sleep(1200)
                    if (!isHistoryScreen()) {
                        goToHistory()
                        sleep(1500)
                    }
                }
            }

            // Scroll down to load more entries
            swipeUp()
            sleep(1800)
            scrollsDone++
        }

        onStatus("Daily sync: collected ${allDetails.size} credit UTR(s) for today.")
        return allDetails
    }

    /**
     * Returns true when a text looks like an explicit past date header (e.g. "Aug 2", "Jul 31").
     * PhonePe shows today as "Today"; anything else is a past date we stop at.
     */
    private fun isPastDateLabel(text: String): Boolean {
        // Month abbreviation followed by a day number: "Aug 2", "Jul 30", etc.
        return Regex("""^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}$""")
            .matches(text.trim())
    }

    /**
     * Rough amount match: strip ₹/+/commas, compare integer part.
     * e.g. "₹145" on list should match pending "145.27"
     */
    private fun amountsRoughlyMatch(listAmount: String, pendingAmount: String): Boolean {
        fun clean(s: String) = s.replace(Regex("[₹+,\\s]"), "").trim()
        val la = clean(listAmount).toDoubleOrNull() ?: return false
        val pa = clean(pendingAmount).toDoubleOrNull() ?: return false
        // Match if within ₹15 of each other (unique amount window)
        return Math.abs(la - pa) <= 15.0
    }

    private fun openPhonePe() {
        val launch = packageManager.getLaunchIntentForPackage("com.phonepe.app")
            ?: throw IllegalStateException("PhonePe is not installed.")
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(launch)
    }

    private fun goToHistory() {
        // Prefer bottom tab
        if (tapText("History", minY = 1100f)) return
        if (tapText("Home", minY = 1100f)) {
            sleep(1200)
            if (tapText("History", minY = 1100f)) return
        }
        // Back out a few times then try again
        repeat(3) {
            performGlobalAction(GLOBAL_ACTION_BACK)
            sleep(800)
            if (isHistoryScreen()) return
            if (tapText("History", minY = 1100f)) return
        }
        throw IllegalStateException("Could not open PhonePe History tab.")
    }

    private fun isHistoryScreen(): Boolean {
        val texts = collectTexts()
        return texts.any { it == "History" } && (
            texts.any { it == "My Statements" || it == "Filter" || it in TYPE_LABELS }
            )
    }

    /** Tap a txn that is already on the first History screen (no scroll). */
    private fun openSummaryOnScreen(target: TxnSummary) {
        val key = "${target.type}|${target.party}|${target.amount}"
        val batch = parseHistoryList(6)
        val match = batch.firstOrNull { "${it.type}|${it.party}|${it.amount}" == key }
            ?: batch.getOrNull(target.index - 1)
            ?: throw IllegalStateException("Latest txn #${target.index} not visible on History.")
        tapXy(360f, matchTapY(match))
    }

    private fun matchTapY(s: TxnSummary): Float {
        // approximate mid of row; stored in whenText as "y:1234" hack optional
        val y = s.whenText.removePrefix("y:").toFloatOrNull()
        return y ?: 700f
    }

    private fun parseHistoryList(limit: Int): List<TxnSummary> {
        val nodes = flatten(rootInActiveWindow ?: return emptyList())
        val labeled = nodes.mapNotNull { n ->
            val t = n.text?.toString()?.trim().orEmpty()
            if (t.isEmpty()) return@mapNotNull null
            val b = android.graphics.Rect()
            n.getBoundsInScreen(b)
            Triple(t, b.centerY(), b)
        }.filter { it.second > 400 }

        val starts = labeled.mapIndexedNotNull { i, triple ->
            if (triple.first in TYPE_LABELS) i else null
        }
        val out = mutableListOf<TxnSummary>()
        for ((idx, start) in starts.withIndex()) {
            if (out.size >= limit) break
            val end = starts.getOrNull(idx + 1) ?: (start + 6).coerceAtMost(labeled.size)
            val chunk = labeled.subList(start, end)
            val labels = chunk.map { it.first }
            val type = labels.firstOrNull().orEmpty()
            val party = labels.getOrNull(1).orEmpty()
            val amount = labels.firstOrNull { it.startsWith("₹") || it.startsWith("+ ₹") }.orEmpty()
            val cy = chunk.getOrNull(1)?.second ?: chunk.first().second
            out += TxnSummary(
                index = out.size + 1,
                type = type,
                party = party,
                amount = amount,
                whenText = "y:$cy",
            )
        }
        return out
    }

    private fun parseDetail(index: Int): TxnDetail {
        val texts = collectTexts()
        val joined = texts.joinToString("\n")
        val status = texts.firstOrNull { it.contains("Successful") || it.contains("Failed") || it.contains("Pending") }.orEmpty()
        val datetime = texts.firstOrNull { Regex("""\d{1,2}:\d{2}\s*(am|pm).*?\d{4}""", RegexOption.IGNORE_CASE).containsMatchIn(it) }.orEmpty()
        val type = texts.firstOrNull { it in TYPE_LABELS }.orEmpty()
        var party = ""
        var amount = ""
        val ti = texts.indexOf(type)
        if (ti >= 0 && ti + 1 < texts.size) {
            party = texts[ti + 1]
            amount = texts.drop(ti + 1).take(3).firstOrNull { it.startsWith("₹") || it.startsWith("+ ₹") }.orEmpty()
        }
        val upi = texts.firstOrNull { it.contains("@") }
            ?: texts.firstOrNull { it.startsWith("XX") || it.contains("Bank") }.orEmpty()
        var txnId = ""
        val idIdx = texts.indexOfFirst { it.contains("PhonePe Transaction ID") }
        if (idIdx >= 0 && idIdx + 1 < texts.size) txnId = texts[idIdx + 1]
        if (txnId.isBlank()) txnId = texts.firstOrNull { it.matches(Regex("""T\d{10,}""")) }.orEmpty()

        var utr = Regex("""UTR[:\s#-]*([A-Za-z0-9]+)""", RegexOption.IGNORE_CASE)
            .find(joined)?.groupValues?.getOrNull(1).orEmpty()
        if (utr.isBlank()) {
            val utrLabelIdx = texts.indexOfFirst {
                it.equals("UTR", ignoreCase = true) ||
                    it.equals("UPI Transaction ID", ignoreCase = true) ||
                    it.equals("Reference No.", ignoreCase = true) ||
                    it.equals("Reference Number", ignoreCase = true) ||
                    it.startsWith("UTR", ignoreCase = true)
            }
            if (utrLabelIdx >= 0) {
                val label = texts[utrLabelIdx]
                val inline = label.replace(Regex("""^(UTR|UPI Transaction ID|Reference No\.?|Reference Number)[:\s#-]*""", RegexOption.IGNORE_CASE), "").trim()
                utr = inline.ifBlank {
                    texts.drop(utrLabelIdx + 1).take(3).firstOrNull {
                        it.matches(Regex("""[A-Za-z0-9]{8,}"""))
                    }.orEmpty()
                }
            }
        }
        // Last resort: PhonePe txn id is unique enough for matching/idempotency
        if (utr.isBlank()) utr = txnId

        var debited = ""
        val dIdx = texts.indexOf("Debited from")
        if (dIdx >= 0) {
            debited = texts.drop(dIdx + 1).take(3).firstOrNull { !it.startsWith("₹") }.orEmpty()
        }

        if (status.isBlank() && texts.contains("History")) {
            throw IllegalStateException("Still on History — detail not opened.")
        }

        return TxnDetail(
            index = index,
            status = status,
            datetime = datetime,
            type = type,
            party = party,
            amount = amount,
            upi_or_bank = upi,
            phonepe_txn_id = txnId,
            utr = utr,
            debited_from = debited,
        )
    }

    private fun collectTexts(): List<String> {
        val root = rootInActiveWindow ?: return emptyList()
        return flatten(root).mapNotNull { it.text?.toString()?.trim()?.takeIf { t -> t.isNotEmpty() } }
    }

    private fun flatten(node: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
        val out = mutableListOf<AccessibilityNodeInfo>()
        fun walk(n: AccessibilityNodeInfo) {
            out += n
            for (i in 0 until n.childCount) {
                n.getChild(i)?.let { walk(it) }
            }
        }
        walk(node)
        return out
    }

    private fun tapText(text: String, minY: Float = 0f): Boolean {
        val root = rootInActiveWindow ?: return false
        val nodes = flatten(root)
        for (n in nodes) {
            val t = n.text?.toString()?.trim() ?: continue
            if (t != text) continue
            val b = android.graphics.Rect()
            n.getBoundsInScreen(b)
            if (b.centerY() < minY) continue
            tapXy(b.exactCenterX(), b.exactCenterY())
            return true
        }
        // also contentDescription
        for (n in nodes) {
            val t = n.contentDescription?.toString()?.trim() ?: continue
            if (t != text) continue
            val b = android.graphics.Rect()
            n.getBoundsInScreen(b)
            if (b.centerY() < minY) continue
            tapXy(b.exactCenterX(), b.exactCenterY())
            return true
        }
        return false
    }

    private fun tapXy(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 80)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        mainHandler.post {
            dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    latch.countDown()
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    latch.countDown()
                }
            }, null)
        }
        latch.await(2, TimeUnit.SECONDS)
    }

    /** Pull-to-refresh: swipe down from top of the list */
    private fun pullToRefresh() {
        val path = Path().apply {
            moveTo(360f, 500f)
            lineTo(360f, 1100f)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 400)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        mainHandler.post {
            dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) = latch.countDown()
                override fun onCancelled(gestureDescription: GestureDescription?) = latch.countDown()
            }, null)
        }
        latch.await(2, TimeUnit.SECONDS)
    }

    private fun swipeUp() {
        val path = Path().apply {
            moveTo(360f, 1250f)
            lineTo(360f, 520f)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 350)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        mainHandler.post {
            dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) = latch.countDown()
                override fun onCancelled(gestureDescription: GestureDescription?) = latch.countDown()
            }, null)
        }
        latch.await(2, TimeUnit.SECONDS)
    }

    private fun sleep(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (_: InterruptedException) {
        }
    }
}
