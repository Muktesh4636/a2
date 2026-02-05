package com.sikwin.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.compose.rememberNavController
import com.sikwin.app.data.api.RetrofitClient
import com.sikwin.app.data.auth.SessionManager
import com.sikwin.app.navigation.AppNavigation
import com.sikwin.app.ui.theme.GunduAtaTheme
import com.sikwin.app.ui.viewmodels.GunduAtaViewModel
import com.sikwin.app.ui.viewmodels.GunduAtaViewModelFactory

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        val sessionManager = SessionManager(this)
        RetrofitClient.init(sessionManager)
        
        setContent {
            GunduAtaTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val navController = rememberNavController()
                    val viewModel: GunduAtaViewModel = viewModel(
                        factory = GunduAtaViewModelFactory(sessionManager)
                    )
                    AppNavigation(
                        navController = navController, 
                        viewModel = viewModel,
                        sessionManager = sessionManager
                    )
                }
            }
        }
    }
}
