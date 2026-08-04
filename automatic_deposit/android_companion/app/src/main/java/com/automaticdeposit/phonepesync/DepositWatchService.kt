package com.automaticdeposit.phonepesync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Polls backend for PENDING auto-deposits.
 * When a new deposit is detected, waits 12s (for the player to complete payment in PhonePe),
 * then opens PhonePe History and syncs transactions. Retries 2 more times at 25s intervals.
 */
class DepositWatchService : Service() {

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var pollFuture: ScheduledFuture<*>? = null
    private var heartbeatFuture: ScheduledFuture<*>? = null
    private var dailySyncFuture: ScheduledFuture<*>? = null
    private val fetching = AtomicBoolean(false)

    /** pendingId we already scheduled a fetch for */
    @Volatile private var scheduledForId: Long = 0
    /** pending_count when we scheduled (restart timer if more deposits arrive) */
    @Volatile private var scheduledForCount: Int = 0
    /** wall-clock time when fetch should run */
    @Volatile private var fetchAtMs: Long = 0
    /** how many fetches we've done for the current deposit id (max 3: 12s, +25s, +25s) */
    @Volatile private var fetchAttemptsForId: Int = 0
    /** pending unique amounts from server (used for amount pre-filter) */
    @Volatile private var pendingAmounts: List<String> = emptyList()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIF_ID, buildNotification("Watching for deposits…"))
        Log.i(TAG, "DepositWatchService started; server=${Prefs.serverUrl(this)}")
        startPolling()
        startHeartbeat()
        startDailySync()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Prefs.setAutoWatch(this, false)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_FORCE_POLL -> {
                fetchAtMs = System.currentTimeMillis()
                scheduler.execute { pollOnce(force = true) }
            }
        }
        Prefs.setAutoWatch(this, true)
        return START_STICKY
    }

    override fun onDestroy() {
        pollFuture?.cancel(true)
        heartbeatFuture?.cancel(true)
        dailySyncFuture?.cancel(true)
        scheduler.shutdownNow()
        super.onDestroy()
    }

    private fun startPolling() {
        pollFuture?.cancel(false)
        pollFuture = scheduler.scheduleWithFixedDelay(
            { pollOnce(force = false) },
            2,
            POLL_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    private fun startHeartbeat() {
        heartbeatFuture?.cancel(false)
        heartbeatFuture = scheduler.scheduleWithFixedDelay(
            { sendHeartbeat() },
            10,
            HEARTBEAT_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    private fun sendHeartbeat() {
        try {
            SyncClient.postHeartbeat(this)
        } catch (t: Throwable) {
            Log.w(TAG, "heartbeat failed: ${t.message}")
        }
    }

    /**
     * Schedule a periodic "sync all today's credits" job.
     * Runs once at start (after a short delay), then every 30 min.
     * This keeps the server UTR log current so instant-match works when a deposit comes in.
     */
    private fun startDailySync() {
        dailySyncFuture?.cancel(false)
        dailySyncFuture = scheduler.scheduleWithFixedDelay(
            { runDailySync() },
            DAILY_SYNC_INITIAL_DELAY_S,
            DAILY_SYNC_INTERVAL_S,
            TimeUnit.SECONDS,
        )
    }

    private fun runDailySync() {
        if (fetching.get()) {
            Log.d(TAG, "daily-sync skipped — fetch in progress")
            return
        }
        if (PhonePeAccessibilityService.instance == null) {
            Log.d(TAG, "daily-sync skipped — accessibility not enabled")
            return
        }
        Log.i(TAG, "daily-sync: starting all-today-credits collection")
        updateNotification("Syncing today's PhonePe credits…")

        val latch = java.util.concurrent.CountDownLatch(1)
        PhonePeAccessibilityService.syncAllTodayCredits(
            onStatus = { msg -> Log.d(TAG, "daily-sync: $msg") },
            onDone = { result ->
                result.onSuccess { details ->
                    Log.i(TAG, "daily-sync: collected ${details.size} UTR(s) for today")
                    updateNotification("Today's UTR log: ${details.size} credit(s) synced")
                }.onFailure { err ->
                    Log.w(TAG, "daily-sync failed: ${err.message}")
                    updateNotification("Daily UTR sync failed — will retry in 30min")
                }
                latch.countDown()
            },
        )
        if (!latch.await(300, TimeUnit.SECONDS)) {
            Log.w(TAG, "daily-sync timed out")
            updateNotification("Watching — daily sync timed out, retrying in 30min")
        }
    }

    private fun pollOnce(force: Boolean) {
        try {
            if (!Prefs.isAccessibilityEnabled(this)) {
                Log.w(TAG, "poll: accessibility off")
                updateNotification("Enable Accessibility to auto-fetch")
                return
            }

            val trigger = SyncClient.fetchPendingTrigger(this)
            val needs = trigger.optBoolean("needs_fetch", false)
            val count = trigger.optInt("pending_count", 0)
            val latestId = trigger.optLong("latest_id", 0)
            Log.i(TAG, "poll needs=$needs count=$count latestId=$latestId url=${Prefs.serverUrl(this)}")
            val amount = trigger.optString("latest_unique_amount", "")
            // N pending deposits → read last N PhonePe History rows, capped at 5 to keep it fast
            val limit = trigger.optInt("fetch_limit", count).coerceIn(1, 5)
            // Store all pending amounts for pre-filtering in AccessibilityService
            val amountsArr = trigger.optJSONArray("pending_amounts")
            pendingAmounts = if (amountsArr != null) {
                (0 until amountsArr.length()).map { amountsArr.getString(it) }
            } else if (amount.isNotBlank()) listOf(amount) else emptyList()
            val now = System.currentTimeMillis()

            if (!needs || count <= 0 || latestId <= 0) {
                scheduledForId = 0
                scheduledForCount = 0
                fetchAtMs = 0
                fetchAttemptsForId = 0
                updateNotification("Watching — waiting for deposit click")
                return
            }

            // Exhausted all 3 attempts for this deposit — stop until a new deposit arrives
            if (scheduledForId == latestId && count == scheduledForCount && fetchAttemptsForId >= MAX_FETCH_ATTEMPTS) {
                updateNotification("Checked 3×. Waiting for new deposit…")
                return
            }

            // New / additional deposit → wait 12s then open PhonePe
            if (latestId != scheduledForId || count > scheduledForCount) {
                scheduledForId = latestId
                scheduledForCount = count
                fetchAttemptsForId = 0
                fetchAtMs = now + FETCH_DELAY_MS
                val amtLabels = if (pendingAmounts.isNotEmpty())
                    pendingAmounts.joinToString(", ") { "₹$it" }
                else if (amount.isNotBlank()) "₹$amount" else ""
                updateNotification(
                    "Pending: $amtLabels ($count deposit(s)) — fetching PhonePe in 12s"
                )
                sendBroadcast(
                    Intent(ACTION_STATUS).setPackage(packageName)
                        .putExtra(EXTRA_STATUS, "Expecting: $amtLabels — PhonePe opens in 12s")
                )
                return
            }

            val remaining = fetchAtMs - now
            if (!force && remaining > 0) {
                val secs = ((remaining + 999) / 1000).coerceAtLeast(1)
                updateNotification("Fetching last $limit txn(s) in ${secs}s ($count pending)")
                return
            }

            if (!fetching.compareAndSet(false, true)) return

            fetchAttemptsForId++
            val attemptLabel = "attempt $fetchAttemptsForId/$MAX_FETCH_ATTEMPTS"
            updateNotification("Opening PhonePe ($attemptLabel)…")
            Prefs.setLastSeenPendingId(this, latestId)

            val latchDone = java.util.concurrent.CountDownLatch(1)
            var errMsg: String? = null
            PhonePeAccessibilityService.fetchAndSync(
                limit = limit,
                pendingAmounts = pendingAmounts,
                onStatus = { msg -> updateNotification(msg) },
                onDone = { result ->
                    result.onSuccess {
                        Prefs.setLastAutoFetchAt(this, System.currentTimeMillis())
                        if (fetchAttemptsForId >= MAX_FETCH_ATTEMPTS) {
                            fetchAtMs = Long.MAX_VALUE
                            updateNotification("Synced ${it.size} txn(s). Checked 3× — waiting for new deposit…")
                        } else {
                            // Still retries left — schedule next check in 25s in case payment is slow
                            fetchAtMs = System.currentTimeMillis() + RETRY_DELAY_MS
                            updateNotification("Synced ${it.size} txn(s). Retry ${fetchAttemptsForId + 1}/$MAX_FETCH_ATTEMPTS in 25s…")
                        }
                        sendBroadcast(
                            Intent(ACTION_STATUS).setPackage(packageName)
                                .putExtra(EXTRA_STATUS, "Synced ${it.size} PhonePe txn(s).")
                        )
                    }.onFailure { err ->
                        errMsg = err.message
                        // Retry once after 25s on failure only
                        fetchAtMs = System.currentTimeMillis() + RETRY_DELAY_MS
                        updateNotification("Fetch failed — retry in 25s: ${err.message}")
                        sendBroadcast(
                            Intent(ACTION_STATUS).setPackage(packageName)
                                .putExtra(EXTRA_STATUS, err.message ?: "Auto-fetch failed")
                        )
                    }
                    fetching.set(false)
                    latchDone.countDown()
                },
            )
            if (!latchDone.await(180, TimeUnit.SECONDS)) {
                fetching.set(false)
                fetchAtMs = System.currentTimeMillis() + RETRY_DELAY_MS  // retry on timeout
                updateNotification("Fetch timed out — retry soon")
                Log.w(TAG, "fetch timeout; err=$errMsg")
            }
        } catch (t: Throwable) {
            fetching.set(false)
            Log.e(TAG, "poll failed", t)
            updateNotification("Watch error: ${t.message}")
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        val ch = NotificationChannel(
            CHANNEL_ID,
            "Deposit watcher",
            NotificationManager.IMPORTANCE_LOW,
        )
        ch.description = "Waits 12s after deposit detected, opens PhonePe History, retries at 25s/50s"
        mgr.createNotificationChannel(ch)
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, DepositWatchService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("PhonePe Sync")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        mgr.notify(NOTIF_ID, buildNotification(text))
    }

    companion object {
        private const val TAG = "DepositWatch"
        private const val CHANNEL_ID = "deposit_watch"
        private const val NOTIF_ID = 4401
        private const val POLL_SECONDS = 3L
        private const val HEARTBEAT_SECONDS = 120L          // ping server every 2 min
        private const val FETCH_DELAY_MS = 12_000L         // wait 12s after deposit detected, then open PhonePe
        private const val RETRY_DELAY_MS = 25_000L         // retry after 25s if still pending
        private const val MAX_FETCH_ATTEMPTS = 3            // attempt 1 (12s), +25s, +50s
        private const val DAILY_SYNC_INITIAL_DELAY_S = 90L  // first sync 90s after service start
        private const val DAILY_SYNC_INTERVAL_S = 1800L     // then every 30 minutes

        const val ACTION_STOP = "com.automaticdeposit.phonepesync.STOP_WATCH"
        const val ACTION_FORCE_POLL = "com.automaticdeposit.phonepesync.FORCE_POLL"
        const val ACTION_STATUS = "com.automaticdeposit.phonepesync.STATUS"
        const val EXTRA_STATUS = "status"

        fun start(ctx: Context) {
            try {
                val i = Intent(ctx, DepositWatchService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ctx.startForegroundService(i)
                } else {
                    ctx.startService(i)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "failed to start DepositWatchService", t)
            }
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, DepositWatchService::class.java).setAction(ACTION_STOP))
        }
    }
}
