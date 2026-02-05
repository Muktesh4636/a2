package com.sikwin.app.navigation

import android.content.Intent
import java.io.File
import java.io.FileOutputStream
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.sikwin.app.data.auth.SessionManager
import com.sikwin.app.ui.screens.*

import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@Composable
fun AppNavigation(
    navController: NavHostController, 
    viewModel: GunduAtaViewModel,
    sessionManager: SessionManager
) {
    val context = LocalContext.current
    val startDestination = if (viewModel.loginSuccess) "home" else "login"
    
    NavHost(navController = navController, startDestination = startDestination) {
        composable("login") {
            LoginScreen(
                viewModel = viewModel,
                onLoginSuccess = { navController.navigate("home") },
                onNavigateToSignUp = { navController.navigate("signup") }
            )
        }
        composable("signup") {
            SignUpScreen(
                viewModel = viewModel,
                onSignUpSuccess = { navController.navigate("home") },
                onNavigateToSignIn = { navController.navigate("login") }
            )
        }
        composable("home") {
            HomeScreen(
                viewModel = viewModel,
                onGameClick = { gameId ->
                    if (gameId == "gundu_ata") {
                        try {
                            val intent = Intent(context, Class.forName("com.unity3d.player.UnityPlayerGameActivity"))
                            intent.putExtra("token", sessionManager.fetchAuthToken())
                            intent.putExtra("refresh_token", sessionManager.fetchRefreshToken())
                            intent.putExtra("username", sessionManager.fetchUsername())
                            intent.putExtra("password", "123456789") // Assuming same password for now or fetch from session if stored
                            intent.putExtra("user_id", sessionManager.fetchUserId())
                            intent.putExtra("game_id", gameId)
                            context.startActivity(intent)
                        } catch (e: Exception) {
                            e.printStackTrace()
                            android.widget.Toast.makeText(context, "Error launching Unity game", android.widget.Toast.LENGTH_SHORT).show()
                        }
                    }
                },
                onNavigate = { route ->
                    if (route == "gundu_ata") {
                        try {
                            val intent = Intent(context, Class.forName("com.unity3d.player.UnityPlayerGameActivity"))
                            intent.putExtra("token", sessionManager.fetchAuthToken())
                            intent.putExtra("refresh_token", sessionManager.fetchRefreshToken())
                            intent.putExtra("username", sessionManager.fetchUsername())
                            intent.putExtra("password", "123456789")
                            context.startActivity(intent)
                        } catch (e: Exception) {
                            e.printStackTrace()
                            android.widget.Toast.makeText(context, "Unity game not found!", android.widget.Toast.LENGTH_SHORT).show()
                        }
                    } else if (route != "home") {
                        navController.navigate(route)
                    }
                }
            )
        }
        composable("me") {
            ProfileScreen(
                viewModel = viewModel,
                onNavigate = { route ->
                    if (route == "gundu_ata") {
                        try {
                            val intent = Intent(context, Class.forName("com.unity3d.player.UnityPlayerGameActivity"))
                            intent.putExtra("token", sessionManager.fetchAuthToken())
                            intent.putExtra("refresh_token", sessionManager.fetchRefreshToken())
                            intent.putExtra("username", sessionManager.fetchUsername() ?: viewModel.userProfile?.username ?: "")
                            intent.putExtra("password", "123456789")
                            intent.putExtra("balance", viewModel.wallet?.balance ?: "0.00")
                            context.startActivity(intent)
                        } catch (e: ClassNotFoundException) {
                            android.util.Log.e("UnityLaunch", "UnityPlayerGameActivity not found.")
                        }
                    } else {
                        navController.navigate(route)
                    }
                }
            )
        }
        composable("wallet") {
            WalletScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onNavigateToDeposit = { navController.navigate("deposit") },
                onNavigateToWithdraw = { navController.navigate("withdraw") }
            )
        }
        composable("deposit") {
            DepositScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onNavigateToWithdraw = { navController.navigate("withdraw") },
                onNavigateToPayment = { amount ->
                    navController.navigate("payment/$amount")
                }
            )
        }
        composable("payment/{amount}") { backStackEntry ->
            val amount = backStackEntry.arguments?.getString("amount") ?: "0"
            PaymentScreen(
                amount = amount,
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onSubmitSuccess = {
                    navController.navigate("deposits_record") {
                        popUpTo("home") { inclusive = false }
                    }
                }
            )
        }
        composable("withdraw") {
            WithdrawScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onAddBankAccount = {
                    navController.navigate("add_bank_account")
                }
            )
        }
        composable("add_bank_account") {
            AddBankAccountScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onSubmitSuccess = {
                    navController.popBackStack()
                }
            )
        }
        composable("transactions") {
            TransactionHistoryScreen(
                title = "Transaction Record",
                initialCategory = "Betting",
                showTabs = true,
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("deposits_record") {
            TransactionHistoryScreen(
                title = "Deposit Record",
                initialCategory = "Deposit",
                showTabs = false,
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("withdrawals_record") {
            TransactionHistoryScreen(
                title = "Withdrawal Record",
                initialCategory = "Withdraw",
                showTabs = false,
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("betting_record") {
            TransactionHistoryScreen(
                title = "Betting Record",
                initialCategory = "Betting",
                showTabs = false,
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("personal_info") {
            PersonalInfoScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("lucky_wheel") {
            LuckyWheelScreen(
                onBack = { navController.popBackStack() }
            )
        }
        composable("withdrawal_account") {
            WithdrawalAccountScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() },
                onAddBankAccount = { navController.navigate("add_bank_account") }
            )
        }
        composable("security") {
            SecurityScreen(
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("info") {
            InfoScreen(
                onBack = { navController.popBackStack() }
            )
        }
    }
}
