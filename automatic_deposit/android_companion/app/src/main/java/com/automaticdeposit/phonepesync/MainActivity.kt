package com.automaticdeposit.phonepesync

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.automaticdeposit.phonepesync.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val msg = intent?.getStringExtra(DepositWatchService.EXTRA_STATUS) ?: return
            binding.status.text = msg
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.serverUrl.setText(Prefs.serverUrl(this))
        binding.syncToken.setText(Prefs.syncToken(this))
        binding.switchAutoWatch.isChecked = Prefs.autoWatchEnabled(this)

        binding.btnSave.setOnClickListener {
            Prefs.save(
                this,
                binding.serverUrl.text?.toString().orEmpty().ifBlank { Prefs.DEFAULT_SERVER_URL },
                binding.syncToken.text?.toString().orEmpty().ifBlank { Prefs.DEFAULT_SYNC_TOKEN },
            )
            Toast.makeText(this, "Saved — ready to sync to production", Toast.LENGTH_SHORT).show()
            applyAutoWatch(binding.switchAutoWatch.isChecked)
        }

        binding.switchAutoWatch.setOnCheckedChangeListener { _, checked ->
            Prefs.setAutoWatch(this, checked)
            applyAutoWatch(checked)
        }

        binding.btnAccessibility.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }

        binding.btnLast3.setOnClickListener { startFetch(3) }
        binding.btnLast5.setOnClickListener { startFetch(5) }
        binding.btnLast10.setOnClickListener { startFetch(10) }
    }

    override fun onStart() {
        super.onStart()
        val filter = IntentFilter(DepositWatchService.ACTION_STATUS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(statusReceiver, filter, RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(statusReceiver, filter)
        }
    }

    override fun onStop() {
        try {
            unregisterReceiver(statusReceiver)
        } catch (_: Exception) {
        }
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        refreshAccessStatus()
        ensureWatchRunning()
    }

    /** Start polling whenever Auto-watch is on (even if Accessibility is still off). */
    private fun ensureWatchRunning() {
        if (!Prefs.autoWatchEnabled(this)) return
        DepositWatchService.start(this)
        binding.status.text = if (Prefs.isAccessibilityEnabled(this)) {
            "Auto-watch ON — will fetch PhonePe ~10s after a deposit starts."
        } else {
            "Auto-watch ON — Enable Accessibility so PhonePe can be opened."
        }
    }

    private fun applyAutoWatch(enabled: Boolean) {
        if (enabled) {
            Prefs.setAutoWatch(this, true)
            DepositWatchService.start(this)
            if (!Prefs.isAccessibilityEnabled(this)) {
                binding.status.text = "Auto-watch ON — still need Accessibility for PhonePe fetch."
                Toast.makeText(this, "Turn on PhonePe Sync in Accessibility", Toast.LENGTH_LONG).show()
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                return
            }
            binding.status.text = "Auto-watch ON — polling for new deposits."
            Toast.makeText(this, "Auto-watch started", Toast.LENGTH_SHORT).show()
        } else {
            DepositWatchService.stop(this)
            binding.status.text = "Auto-watch OFF — use Last 3/5/10 manually."
        }
    }

    private fun refreshAccessStatus() {
        val on = Prefs.isAccessibilityEnabled(this)
        binding.accessStatus.text = if (on) {
            "Accessibility: ON"
        } else {
            "Accessibility: OFF — tap Enable, then turn on PhonePe Sync"
        }
    }

    private fun setBusy(busy: Boolean) {
        binding.btnLast3.isEnabled = !busy
        binding.btnLast5.isEnabled = !busy
        binding.btnLast10.isEnabled = !busy
        binding.btnSave.isEnabled = !busy
        binding.switchAutoWatch.isEnabled = !busy
    }

    private fun startFetch(limit: Int) {
        Prefs.save(
            this,
            binding.serverUrl.text?.toString().orEmpty(),
            binding.syncToken.text?.toString().orEmpty(),
        )
        if (!Prefs.isAccessibilityEnabled(this)) {
            binding.status.text = "Enable Accessibility for PhonePe Sync first."
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            return
        }
        setBusy(true)
        binding.resultBox.text = ""
        binding.status.text = "Starting Last $limit…"

        PhonePeAccessibilityService.fetchAndSync(
            limit = limit,
            onStatus = { msg ->
                runOnUiThread { binding.status.text = msg }
            },
            onDone = { result ->
                runOnUiThread {
                    setBusy(false)
                    result.onSuccess { details ->
                        val lines = details.joinToString("\n\n") { d ->
                            "#${d.index} ${d.type} ${d.party}\n${d.amount} · ${d.datetime}\nUTR: ${d.utr.ifBlank { "—" }}\nTxn: ${d.phonepe_txn_id}"
                        }
                        binding.resultBox.text = lines
                        binding.status.text = "Synced ${details.size} transaction(s) to website."
                    }.onFailure { err ->
                        binding.status.text = err.message ?: err.toString()
                    }
                }
            },
        )
    }
}
