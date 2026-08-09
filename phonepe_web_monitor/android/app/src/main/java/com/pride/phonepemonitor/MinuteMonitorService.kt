package com.pride.phonepemonitor

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
 * Every 1 minute: open PhonePe History, read recent credits,
 * and upload new ones in one POST /api/sync/ call.
 *
 * First run after install/login: ALL today + yesterday credits.
 * Later runs: only the latest few not yet recorded on this device.
 */
class MinuteMonitorService : Service() {

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var tickFuture: ScheduledFuture<*>? = null
    private var heartbeatFuture: ScheduledFuture<*>? = null
    private val running = AtomicBoolean(false)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIF_ID, buildNotification("Starting 1‑min PhonePe monitor…"))
        Log.i(TAG, "MinuteMonitorService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Prefs.setMonitorEnabled(this, false)
                Prefs.setLastStatus(this, "Monitor stopped")
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_FORCE -> {
                Prefs.setMonitorEnabled(this, true)
                startTicker()
                startHeartbeat()
                scheduler.execute { checkOnce() }
            }
            else -> {
                Prefs.setMonitorEnabled(this, true)
                startTicker()
                startHeartbeat()
                Prefs.setLastStatus(this, "Monitor running — checks every 1 minute")
                updateNotification("Monitoring PhonePe every 1 minute")
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        tickFuture?.cancel(true)
        heartbeatFuture?.cancel(true)
        scheduler.shutdownNow()
        super.onDestroy()
    }

    private fun startTicker() {
        if (tickFuture != null && !tickFuture!!.isCancelled) return
        tickFuture = scheduler.scheduleWithFixedDelay(
            { checkOnce() },
            15,
            INTERVAL_SECONDS,
            TimeUnit.SECONDS,
        )
    }

    private fun startHeartbeat() {
        if (heartbeatFuture != null && !heartbeatFuture!!.isCancelled) return
        heartbeatFuture = scheduler.scheduleWithFixedDelay(
            {
                try {
                    MonitorSyncClient.postHeartbeat(this)
                } catch (t: Throwable) {
                    Log.w(TAG, "heartbeat: ${t.message}")
                }
            },
            20,
            120,
            TimeUnit.SECONDS,
        )
    }

    private fun checkOnce() {
        if (!running.compareAndSet(false, true)) {
            Log.d(TAG, "skip — previous check still running")
            return
        }
        try {
            Prefs.ensureDefaults(this)
            Prefs.setLastCheckAt(this, System.currentTimeMillis())
            if (!Prefs.isAccessibilityEnabled(this)) {
                setStatus("TURN ON Accessibility → PhonePe Web Monitor (required)")
                // Ask UI to open Accessibility settings
                sendBroadcast(
                    Intent(ACTION_NEED_ACCESSIBILITY).setPackage(packageName)
                )
                return
            }
            if (!Prefs.isLoggedIn(this)) {
                setStatus("Login required (staff account)")
                return
            }
            if (Prefs.syncToken(this).isBlank() && Prefs.accessToken(this).isBlank()) {
                setStatus("Login required")
                return
            }
            if (PhonePeReaderService.instance == null) {
                setStatus("Accessibility connected? Toggle PhonePe Web Monitor OFF/ON")
                return
            }

            setStatus(
                if (!Prefs.initialFullSyncDone(this)) {
                    "First sync — today + yesterday credits…"
                } else {
                    "Checking latest today's credits…"
                }
            )
            val latch = java.util.concurrent.CountDownLatch(1)
            val onDone: (Result<List<TxnDetail>>) -> Unit = { result ->
                result.onSuccess { details ->
                    val msg = if (details.isEmpty()) {
                        "OK — no new credits since last check"
                    } else {
                        "Synced ${details.size} new txn(s) in one API call"
                    }
                    setStatus(msg)
                    Log.i(TAG, msg)
                }.onFailure { err ->
                    setStatus("Check failed: ${err.message}")
                    Log.e(TAG, "check failed", err)
                }
                latch.countDown()
            }
            if (!Prefs.initialFullSyncDone(this)) {
                // First time: full today + yesterday catch-up
                PhonePeReaderService.syncTodayAndYesterdayAndUpload(
                    onStatus = { setStatus(it) },
                    onDone = onDone,
                )
            } else {
                // Later: only latest few TODAY credits not yet recorded
                PhonePeReaderService.fetchLatestTodayAndUpload(
                    limit = FETCH_LIMIT,
                    onStatus = { setStatus(it) },
                    onDone = onDone,
                )
            }
            if (!latch.await(420, TimeUnit.SECONDS)) {
                setStatus("Check timed out")
            }
        } catch (t: Throwable) {
            Log.e(TAG, "checkOnce", t)
            setStatus("Error: ${t.message}")
        } finally {
            running.set(false)
        }
    }

    private fun setStatus(msg: String) {
        Prefs.setLastStatus(this, msg)
        updateNotification(msg)
        sendBroadcast(
            Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_STATUS, msg)
        )
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "PhonePe 1‑min monitor", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun buildNotification(text: String): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, MinuteMonitorService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("PhonePe Web Monitor")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentIntent(open)
            .addAction(0, "Stop", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            ?.notify(NOTIF_ID, buildNotification(text))
    }

    companion object {
        private const val TAG = "MinuteMonitor"
        private const val CHANNEL_ID = "phonepe_minute_monitor"
        private const val NOTIF_ID = 5501
        private const val INTERVAL_SECONDS = 60L
        /** Only the latest few History rows each minute — not the full day. */
        private const val FETCH_LIMIT = 3

        const val ACTION_STOP = "com.pride.phonepemonitor.STOP"
        const val ACTION_FORCE = "com.pride.phonepemonitor.FORCE"
        const val ACTION_STATUS = "com.pride.phonepemonitor.STATUS"
        const val ACTION_NEED_ACCESSIBILITY = "com.pride.phonepemonitor.NEED_ACCESSIBILITY"
        const val EXTRA_STATUS = "status"

        fun start(ctx: Context) {
            val i = Intent(ctx, MinuteMonitorService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i)
            } else {
                ctx.startService(i)
            }
        }

        fun stop(ctx: Context) {
            ctx.startService(Intent(ctx, MinuteMonitorService::class.java).setAction(ACTION_STOP))
        }

        fun forceCheck(ctx: Context) {
            ctx.startService(Intent(ctx, MinuteMonitorService::class.java).setAction(ACTION_FORCE))
        }
    }
}
