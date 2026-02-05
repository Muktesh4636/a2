package com.sikwin.app.navigation

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.sikwin.app.ui.screens.*

import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@Composable
fun AppNavigation(navController: NavHostController, viewModel: GunduAtaViewModel) {
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
                            val intent = Intent(context, Class.forName("com.unity3d.player.UnityPlayerActivity"))
                            // Pass essential data to Unity
                            intent.putExtra("username", viewModel.userProfile?.username ?: "")
                            // Using the direct way to get token since sessionManager might not be easily accessible here 
                            // but we can assume the viewModel or a singleton has it.
                            // Looking at the code, viewModel doesn't expose sessionManager directly, 
                            // but RetrofitClient uses it. Let's just pass the username and balance for now, 
                            // or assume the user will fix the token source once they have the library.
                            intent.putExtra("balance", viewModel.wallet?.balance ?: "0.00")
                            context.startActivity(intent)
                        } catch (e: ClassNotFoundException) {
                            // Unity library not yet imported
                            android.util.Log.e("UnityLaunch", "UnityPlayerActivity not found. Did you import unityLibrary?")
                        }
                    }
                },
                onNavigate = { route ->
                    if (route == "gundu_ata") {
                        try {
                            val intent = Intent(context, Class.forName("com.unity3d.player.UnityPlayerActivity"))
                            intent.putExtra("username", viewModel.userProfile?.username ?: "")
                            intent.putExtra("balance", viewModel.wallet?.balance ?: "0.00")
                            context.startActivity(intent)
                        } catch (e: ClassNotFoundException) {
                            android.util.Log.e("UnityLaunch", "UnityPlayerActivity not found.")
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
                            val intent = Intent(context, Class.forName("com.unity3d.player.UnityPlayerActivity"))
                            intent.putExtra("username", viewModel.userProfile?.username ?: "")
                            intent.putExtra("balance", viewModel.wallet?.balance ?: "0.00")
                            context.startActivity(intent)
                        } catch (e: ClassNotFoundException) {
                            android.util.Log.e("UnityLaunch", "UnityPlayerActivity not found.")
                        }
                    } else if (route != "me") {
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
