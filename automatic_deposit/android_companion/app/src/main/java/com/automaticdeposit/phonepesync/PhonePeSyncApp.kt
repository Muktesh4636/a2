package com.automaticdeposit.phonepesync

import android.app.Application
import android.os.Handler
import android.os.Looper

class PhonePeSyncApp : Application() {
    override fun onCreate() {
        super.onCreate()
        // Restart watch after process death / a11y rebind (deferred so FGS rules allow it)
        Handler(Looper.getMainLooper()).postDelayed({
            if (Prefs.autoWatchEnabled(this)) {
                DepositWatchService.start(this)
            }
        }, 1500)
    }
}
