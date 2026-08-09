package com.pride.phonepemonitor

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
class PhonePeReaderService : AccessibilityService() {

    companion object {
        @Volatile var instance: PhonePeReaderService? = null
        private val fetchLock = Any()
        @Volatile private var fetchRunning = false

        private val TYPE_LABELS = setOf(
            "Paid to", "Transfer to", "Received from", "Paid securely", "Money added"
        )
        /** Prefer credits when auto-fetching for deposits */
        private val CREDIT_LABELS = setOf("Received from", "Money added")

        /**
         * Fast 1‑min check: open History, read only the latest [limit] TODAY credits,
         * upload only ones not seen before (one API call). Does NOT scroll all of today.
         */
        fun fetchLatestTodayAndUpload(
            limit: Int = 3,
            onStatus: (String) -> Unit,
            onDone: (Result<List<TxnDetail>>) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                onDone(Result.failure(IllegalStateException("Enable Accessibility for PhonePe Web Monitor first.")))
                return
            }
            synchronized(fetchLock) {
                if (fetchRunning) {
                    onDone(Result.failure(IllegalStateException("PhonePe fetch already running.")))
                    return
                }
                fetchRunning = true
            }
            thread(name = "phonepe-latest") {
                try {
                    onStatus("Opening PhonePe — latest today's only…")
                    val latest = svc.collectLatestTodayCredits(limit.coerceIn(1, 5), onStatus)
                    val seen = Prefs.seenFingerprints(svc)
                    val fresh = latest.filter { it.fingerprint() !in seen }
                    // Remember everything we looked at so we don't re-open them next minute
                    Prefs.markSeen(svc, latest.map { it.fingerprint() })
                    if (fresh.isEmpty()) {
                        onStatus("No new credits (checked ${latest.size} latest)")
                        onDone(Result.success(emptyList()))
                        return@thread
                    }
                    onStatus("Uploading ${fresh.size} new txn(s) in one API call…")
                    MonitorSyncClient.upload(svc, fresh)
                    onDone(Result.success(fresh))
                } catch (t: Throwable) {
                    onDone(Result.failure(t))
                } finally {
                    fetchRunning = false
                }
            }
        }

        fun fetchAndSync(
            limit: Int,
            pendingAmounts: List<String> = emptyList(),
            onStatus: (String) -> Unit,
            onDone: (Result<List<TxnDetail>>) -> Unit,
        ) {
            fetchNewAndUpload(limit, pendingAmounts, onlyNew = false, onStatus, onDone)
        }

        /**
         * Read recent PhonePe credits and upload.
         * When [onlyNew] is true, skips fingerprints already stored on device.
         */
        fun fetchNewAndUpload(
            limit: Int,
            pendingAmounts: List<String> = emptyList(),
            onlyNew: Boolean = true,
            onStatus: (String) -> Unit,
            onDone: (Result<List<TxnDetail>>) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                onDone(Result.failure(IllegalStateException("Enable Accessibility for PhonePe Web Monitor first.")))
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
                    val toUpload = if (onlyNew) {
                        val seen = Prefs.seenFingerprints(svc)
                        details.filter { it.fingerprint() !in seen }
                    } else {
                        details
                    }
                    if (toUpload.isEmpty()) {
                        onStatus("No new transactions (checked ${details.size})")
                        // Still remember what we saw so we don't re-open forever
                        Prefs.markSeen(svc, details.map { it.fingerprint() })
                        onDone(Result.success(emptyList()))
                        return@thread
                    }
                    onStatus("Uploading ${toUpload.size} new txn(s) to server…")
                    MonitorSyncClient.upload(svc, toUpload)
                    Prefs.markSeen(svc, details.map { it.fingerprint() })
                    onDone(Result.success(toUpload))
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
            thread(name = "phonepe-today-sync") {
                try {
                    onStatus("Opening PhonePe — today's credits only…")
                    val details = svc.collectAllTodayCredits(onStatus)
                        .filter { isTodayTxn(it) }
                    if (details.isEmpty()) {
                        onStatus("No credit transactions for today")
                        onDone(Result.success(emptyList()))
                        return@thread
                    }
                    onStatus("Uploading ${details.size} today's credit(s) in one API call…")
                    MonitorSyncClient.upload(svc, details)
                    Prefs.markSeen(svc, details.map { it.fingerprint() })
                    onDone(Result.success(details))
                } catch (t: Throwable) {
                    onDone(Result.failure(t))
                } finally {
                    fetchRunning = false
                }
            }
        }

        /**
         * First-run catch-up: ALL today + yesterday credits, then mark them seen.
         * Skips fingerprints already recorded on this device.
         */
        fun syncTodayAndYesterdayAndUpload(
            onStatus: (String) -> Unit,
            onDone: (Result<List<TxnDetail>>) -> Unit,
        ) {
            val svc = instance
            if (svc == null) {
                onDone(Result.failure(IllegalStateException("Enable Accessibility for PhonePe Web Monitor first.")))
                return
            }
            synchronized(fetchLock) {
                if (fetchRunning) {
                    onDone(Result.failure(IllegalStateException("PhonePe fetch already running.")))
                    return
                }
                fetchRunning = true
            }
            thread(name = "phonepe-today-yesterday") {
                try {
                    onStatus("First sync — collecting today + yesterday credits…")
                    val details = svc.collectTodayAndYesterdayCredits(onStatus)
                        .filter { isTodayOrYesterdayTxn(it) }
                    val seen = Prefs.seenFingerprints(svc)
                    val fresh = details.filter { it.fingerprint() !in seen }
                    Prefs.markSeen(svc, details.map { it.fingerprint() })
                    if (fresh.isEmpty()) {
                        onStatus("First sync done — nothing new to upload (${details.size} checked)")
                        Prefs.setInitialFullSyncDone(svc, true)
                        onDone(Result.success(emptyList()))
                        return@thread
                    }
                    onStatus("Uploading ${fresh.size} today/yesterday credit(s)…")
                    MonitorSyncClient.upload(svc, fresh)
                    Prefs.setInitialFullSyncDone(svc, true)
                    onDone(Result.success(fresh))
                } catch (t: Throwable) {
                    onDone(Result.failure(t))
                } finally {
                    fetchRunning = false
                }
            }
        }

        /** True when PhonePe detail looks like today (not Yesterday / older date). */
        fun isTodayTxn(d: TxnDetail): Boolean {
            val dt = d.datetime.trim()
            if (dt.isBlank()) return true // History list rows under Today section often lack full datetime until opened
            val lower = dt.lowercase()
            if (lower.contains("yesterday")) return false
            if (Regex("""\b(\d+)\s+days?\s+ago\b""").containsMatchIn(lower)) return false
            // Explicit past calendar date like "Aug 2, 2026" / "02 Aug" without "Today"
            if (Regex("""\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b""", RegexOption.IGNORE_CASE)
                    .containsMatchIn(dt)
                && !lower.contains("today")
            ) {
                // PhonePe often shows "4:21 pm, 4 Aug 2026" for today too — compare day+month to device today
                return matchesDeviceToday(dt)
            }
            return true
        }

        /** Today or yesterday — used on first full catch-up sync. */
        fun isTodayOrYesterdayTxn(d: TxnDetail): Boolean {
            val dt = d.datetime.trim()
            if (dt.isBlank()) return true
            val lower = dt.lowercase()
            if (lower.contains("yesterday") || lower.contains("today")) return true
            val daysAgo = Regex("""\b(\d+)\s+days?\s+ago\b""").find(lower)
            if (daysAgo != null) {
                val n = daysAgo.groupValues[1].toIntOrNull() ?: return false
                return n <= 1
            }
            if (Regex("""\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b""", RegexOption.IGNORE_CASE)
                    .containsMatchIn(dt)
            ) {
                return matchesDeviceToday(dt) || matchesDeviceYesterday(dt)
            }
            return true
        }

        private fun matchesDeviceToday(datetime: String): Boolean {
            return matchesDeviceDayOffset(datetime, daysBack = 0)
        }

        private fun matchesDeviceYesterday(datetime: String): Boolean {
            return matchesDeviceDayOffset(datetime, daysBack = 1)
        }

        private fun matchesDeviceDayOffset(datetime: String, daysBack: Int): Boolean {
            return try {
                val cal = java.util.Calendar.getInstance()
                cal.add(java.util.Calendar.DAY_OF_YEAR, -daysBack)
                val day = cal.get(java.util.Calendar.DAY_OF_MONTH)
                val monthIdx = cal.get(java.util.Calendar.MONTH) // 0-based
                val year = cal.get(java.util.Calendar.YEAR)
                val months = listOf(
                    "jan", "feb", "mar", "apr", "may", "jun",
                    "jul", "aug", "sep", "oct", "nov", "dec"
                )
                val monthName = months[monthIdx]
                val lower = datetime.lowercase()
                val hasMonth = lower.contains(monthName)
                val hasDay = Regex("""\b$day\b""").containsMatchIn(lower)
                val hasYear = lower.contains(year.toString()) || !Regex("""\b20\d{2}\b""").containsMatchIn(lower)
                hasMonth && hasDay && hasYear
            } catch (_: Exception) {
                true
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

    /**
     * Fast path for 1‑min monitor: only the top of History (no full-day scroll).
     * Takes up to [limit] TODAY credit rows above any Yesterday/past section.
     */
    private fun collectLatestTodayCredits(limit: Int, onStatus: (String) -> Unit): List<TxnDetail> {
        val capped = limit.coerceIn(1, 5)
        openPhonePe()
        sleep(2200)
        goToHistory()
        sleep(1000)
        refreshHistoryStrongly(onStatus)

        val texts = collectTexts()
        val pastY = findPastSectionY(texts)
        val creditRows = parseHistoryList(capped + 6).filter {
            (it.type in CREDIT_LABELS || it.amount.trimStart().startsWith("+")) &&
                rowIsAbovePastSection(it, pastY)
        }.take(capped)

        if (creditRows.isEmpty()) {
            onStatus("No today's credits at top of History")
            return emptyList()
        }

        val details = mutableListOf<TxnDetail>()
        for ((i, row) in creditRows.withIndex()) {
            onStatus("Reading latest #${i + 1}: ${row.party} ${row.amount}…")
            try {
                openSummaryOnScreen(row)
                sleep(2200)
                val d = parseDetail(i + 1).copy(
                    type = row.type,
                    party = row.party.ifBlank { "" },
                    amount = row.amount,
                )
                if (!isTodayTxn(d)) {
                    onStatus("Hit older txn — stop (today only)")
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    sleep(800)
                    break
                }
                details += d
            } catch (_: Exception) {
                // skip
            } finally {
                performGlobalAction(GLOBAL_ACTION_BACK)
                sleep(1000)
                if (!isHistoryScreen()) {
                    goToHistory()
                    sleep(1200)
                }
            }
        }
        onStatus("Latest today: ${details.size} credit(s)")
        return details
    }

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
        onStatus("Refreshing PhonePe History…")
        refreshHistoryStrongly(onStatus)

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
     * Collect ALL of today's credit transactions.
     * Reads History under the Today section only; stops when Yesterday / older dates appear.
     * Opens each credit row to extract UTR. Caps at 40.
     */
    private fun collectAllTodayCredits(onStatus: (String) -> Unit): List<TxnDetail> {
        openPhonePe()
        sleep(2200)
        goToHistory()
        sleep(1500)
        onStatus("Refreshing today's PhonePe History…")
        refreshHistoryStrongly(onStatus)

        val seenKeys = mutableSetOf<String>()
        val allDetails = mutableListOf<TxnDetail>()
        val MAX_TXNS = 40
        val MAX_SCROLLS = 6
        val DATE_STOP_LABELS = setOf("Yesterday", "2 days ago", "3 days ago", "4 days ago", "5 days ago")

        var scrollsDone = 0
        outer@ while (scrollsDone <= MAX_SCROLLS && allDetails.size < MAX_TXNS) {
            val texts = collectTexts()
            val pastY = findPastSectionY(texts)
            val creditRows = parseHistoryList(24).filter {
                (it.type in CREDIT_LABELS || it.amount.trimStart().startsWith("+")) &&
                    rowIsAbovePastSection(it, pastY)
            }

            for (row in creditRows) {
                val key = "${row.type}|${row.party}|${row.amount}"
                if (key in seenKeys) continue
                if (allDetails.size >= MAX_TXNS) break@outer
                seenKeys += key
                onStatus("Reading today: ${row.party} ${row.amount}…")
                try {
                    openSummaryOnScreen(row)
                    sleep(2400)
                    val d = parseDetail(row.index)
                    val detail = d.copy(
                        type = d.type.ifBlank { row.type },
                        party = d.party.ifBlank { row.party },
                        amount = d.amount.ifBlank { row.amount },
                    )
                    if (!isTodayTxn(detail)) {
                        onStatus("Reached older txn — stopping.")
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        sleep(800)
                        break@outer
                    }
                    allDetails += detail
                } catch (_: Exception) {
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

            // Past section already on screen → don't scroll into older days
            if (pastY != null || texts.any { it in DATE_STOP_LABELS || isPastDateLabel(it) }) {
                onStatus("Reached end of today's section.")
                break
            }

            swipeUp()
            sleep(1800)
            scrollsDone++
        }

        onStatus("Collected ${allDetails.size} credit(s) for today.")
        return allDetails
    }

    /**
     * Collect ALL credits for today AND yesterday.
     * Stops when "2 days ago" / older date headers appear (not Yesterday).
     * Caps at 80.
     */
    private fun collectTodayAndYesterdayCredits(onStatus: (String) -> Unit): List<TxnDetail> {
        openPhonePe()
        sleep(2200)
        goToHistory()
        sleep(1500)
        onStatus("Refreshing today + yesterday PhonePe History…")
        refreshHistoryStrongly(onStatus)

        val seenKeys = mutableSetOf<String>()
        val allDetails = mutableListOf<TxnDetail>()
        val MAX_TXNS = 80
        val MAX_SCROLLS = 14
        val TOO_OLD_LABELS = setOf("2 days ago", "3 days ago", "4 days ago", "5 days ago", "6 days ago", "7 days ago")

        var scrollsDone = 0
        outer@ while (scrollsDone <= MAX_SCROLLS && allDetails.size < MAX_TXNS) {
            val texts = collectTexts()
            val olderY = findOlderThanYesterdaySectionY(texts)
            val creditRows = parseHistoryList(28).filter {
                (it.type in CREDIT_LABELS || it.amount.trimStart().startsWith("+")) &&
                    rowIsAbovePastSection(it, olderY)
            }

            for (row in creditRows) {
                val key = "${row.type}|${row.party}|${row.amount}"
                if (key in seenKeys) continue
                if (allDetails.size >= MAX_TXNS) break@outer
                seenKeys += key
                onStatus("Reading today/yesterday: ${row.party} ${row.amount}…")
                try {
                    openSummaryOnScreen(row)
                    sleep(2400)
                    val d = parseDetail(row.index)
                    val detail = d.copy(
                        type = d.type.ifBlank { row.type },
                        party = d.party.ifBlank { row.party },
                        amount = d.amount.ifBlank { row.amount },
                    )
                    if (!isTodayOrYesterdayTxn(detail)) {
                        onStatus("Reached older than yesterday — stopping.")
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        sleep(800)
                        break@outer
                    }
                    allDetails += detail
                } catch (_: Exception) {
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

            if (olderY != null || texts.any { it in TOO_OLD_LABELS || isOlderThanYesterdayDateLabel(it) }) {
                onStatus("Reached end of yesterday section.")
                break
            }

            swipeUp()
            sleep(1800)
            scrollsDone++
        }

        onStatus("Collected ${allDetails.size} credit(s) for today + yesterday.")
        return allDetails
    }

    /** Y of first "Yesterday"/past-date header on screen, or null if only Today is visible. */
    private fun findPastSectionY(texts: List<String>): Float? {
        val root = rootInActiveWindow ?: return null
        val nodes = flatten(root)
        var minY: Float? = null
        for (n in nodes) {
            val t = n.text?.toString()?.trim().orEmpty()
            if (t.isEmpty()) continue
            if (t == "Yesterday" || t.endsWith("days ago") || isPastDateLabel(t)) {
                val b = android.graphics.Rect()
                n.getBoundsInScreen(b)
                val y = b.top.toFloat()
                if (minY == null || y < minY) minY = y
            }
        }
        return minY
    }

    /** Y of first section older than yesterday (2+ days ago / older date). Yesterday is allowed. */
    private fun findOlderThanYesterdaySectionY(texts: List<String>): Float? {
        val root = rootInActiveWindow ?: return null
        val nodes = flatten(root)
        var minY: Float? = null
        for (n in nodes) {
            val t = n.text?.toString()?.trim().orEmpty()
            if (t.isEmpty()) continue
            if (t == "Yesterday") continue
            val tooOldLabel = t.endsWith("days ago") && t != "1 day ago"
            if (tooOldLabel || isOlderThanYesterdayDateLabel(t)) {
                val b = android.graphics.Rect()
                n.getBoundsInScreen(b)
                val y = b.top.toFloat()
                if (minY == null || y < minY) minY = y
            }
        }
        return minY
    }

    private fun rowIsAbovePastSection(row: TxnSummary, pastY: Float?): Boolean {
        if (pastY == null) return true
        val y = row.whenText.removePrefix("y:").toFloatOrNull() ?: return true
        return y < pastY - 20f
    }

    /**
     * Past date header like "Aug 3" — but NOT today's month+day.
     */
    private fun isPastDateLabel(text: String): Boolean {
        val t = text.trim()
        val m = Regex("""^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$""", RegexOption.IGNORE_CASE)
            .matchEntire(t) ?: return false
        val monthName = m.groupValues[1].lowercase()
        val day = m.groupValues[2].toIntOrNull() ?: return true
        val cal = java.util.Calendar.getInstance()
        val months = listOf(
            "jan", "feb", "mar", "apr", "may", "jun",
            "jul", "aug", "sep", "oct", "nov", "dec"
        )
        val todayMonth = months[cal.get(java.util.Calendar.MONTH)]
        val todayDay = cal.get(java.util.Calendar.DAY_OF_MONTH)
        // Same month+day as device today → treat as Today header, not past
        if (monthName == todayMonth && day == todayDay) return false
        return true
    }

    /** Date header older than yesterday (not Today, not Yesterday's calendar day). */
    private fun isOlderThanYesterdayDateLabel(text: String): Boolean {
        val t = text.trim()
        val m = Regex("""^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$""", RegexOption.IGNORE_CASE)
            .matchEntire(t) ?: return false
        val monthName = m.groupValues[1].lowercase()
        val day = m.groupValues[2].toIntOrNull() ?: return true
        val months = listOf(
            "jan", "feb", "mar", "apr", "may", "jun",
            "jul", "aug", "sep", "oct", "nov", "dec"
        )
        fun matchesOffset(daysBack: Int): Boolean {
            val cal = java.util.Calendar.getInstance()
            cal.add(java.util.Calendar.DAY_OF_YEAR, -daysBack)
            return monthName == months[cal.get(java.util.Calendar.MONTH)] &&
                day == cal.get(java.util.Calendar.DAY_OF_MONTH)
        }
        if (matchesOffset(0) || matchesOffset(1)) return false
        return true
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
        launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
        startActivity(launch)
        sleep(800)
        // Nudge frozen PhonePe (Samsung Freecess) back to foreground
        try {
            val again = packageManager.getLaunchIntentForPackage("com.phonepe.app")
            again?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            if (again != null) startActivity(again)
        } catch (_: Exception) {
        }
    }

    private fun goToHistory() {
        val tabMinY = screenH() * 0.72f
        // Prefer bottom tab
        if (tapText("History", minY = tabMinY)) {
            sleep(900)
            return
        }
        if (tapText("Home", minY = tabMinY)) {
            sleep(1200)
            if (tapText("History", minY = tabMinY)) {
                sleep(900)
                return
            }
        }
        // Back out a few times then try again
        repeat(3) {
            performGlobalAction(GLOBAL_ACTION_BACK)
            sleep(800)
            if (isHistoryScreen()) return
            if (tapText("History", minY = tabMinY)) {
                sleep(900)
                return
            }
        }
        throw IllegalStateException("Could not open PhonePe History tab.")
    }

    /**
     * Reload latest txns by switching tabs: History → Home → History.
     * PhonePe refreshes the list on this tab change (no pull-to-refresh).
     */
    private fun refreshHistoryStrongly(onStatus: (String) -> Unit) {
        val tabMinY = screenH() * 0.72f
        onStatus("Home → History (auto refresh)…")

        // Leave History
        if (!tapText("Home", minY = tabMinY)) {
            // Fallback: try content description / lower threshold
            tapText("Home", minY = screenH() * 0.65f)
        }
        sleep(1200)

        // Re-enter History — list reloads automatically
        if (!tapText("History", minY = tabMinY)) {
            if (!tapText("History", minY = screenH() * 0.65f)) {
                goToHistory()
            }
        }
        sleep(1800)

        // One more bounce if list still empty
        if (parseHistoryList(2).isEmpty()) {
            onStatus("Retry Home → History…")
            tapText("Home", minY = tabMinY)
            sleep(1100)
            tapText("History", minY = tabMinY)
            sleep(1800)
        }
    }

    private fun screenW(): Float {
        val dm = resources.displayMetrics
        return dm.widthPixels.toFloat()
    }

    private fun screenH(): Float {
        val dm = resources.displayMetrics
        return dm.heightPixels.toFloat()
    }

    private fun screenCx(): Float = screenW() / 2f

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
        tapXy(screenCx(), matchTapY(match))
    }

    private fun matchTapY(s: TxnSummary): Float {
        val y = s.whenText.removePrefix("y:").toFloatOrNull()
        return y ?: (screenH() * 0.35f)
    }

    private fun parseHistoryList(limit: Int): List<TxnSummary> {
        val nodes = flatten(rootInActiveWindow ?: return emptyList())
        val minY = screenH() * 0.12f
        val labeled = nodes.mapNotNull { n ->
            val t = n.text?.toString()?.trim().orEmpty()
            if (t.isEmpty()) return@mapNotNull null
            val b = android.graphics.Rect()
            n.getBoundsInScreen(b)
            Triple(t, b.centerY().toFloat(), b)
        }.filter { it.second > minY }

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

    /** Pull-to-refresh using this phone's real screen size (S24 Ultra etc.). */
    private fun pullToRefresh() {
        val cx = screenCx()
        val h = screenH()
        // Start in the list area (below title), drag far down
        val startY = h * 0.22f
        val endY = h * 0.55f
        dispatchSwipe(cx, startY, cx, endY, durationMs = 550)
        sleep(300)
        // Second slightly offset swipe in case first missed the scrollable view
        dispatchSwipe(cx * 0.92f, startY + 40f, cx * 0.92f, endY + 80f, durationMs = 500)
    }

    /** Flick upward briefly then down to settle near top before pull-to-refresh. */
    private fun scrollListToTop() {
        val cx = screenCx()
        val h = screenH()
        // Small upward then strong downward flings tend to expose pull-to-refresh
        dispatchSwipe(cx, h * 0.35f, cx, h * 0.55f, durationMs = 280)
        sleep(250)
        dispatchSwipe(cx, h * 0.35f, cx, h * 0.62f, durationMs = 320)
    }

    private fun swipeUp() {
        val cx = screenCx()
        val h = screenH()
        dispatchSwipe(cx, h * 0.72f, cx, h * 0.28f, durationMs = 380)
    }

    private fun dispatchSwipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long) {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val latch = CountDownLatch(1)
        mainHandler.post {
            dispatchGesture(gesture, object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) = latch.countDown()
                override fun onCancelled(gestureDescription: GestureDescription?) = latch.countDown()
            }, null)
        }
        latch.await(3, TimeUnit.SECONDS)
    }

    private fun sleep(ms: Long) {
        try {
            Thread.sleep(ms)
        } catch (_: InterruptedException) {
        }
    }
}
