package com.sikwin.app.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import com.sikwin.app.ui.screens.*

import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@Composable
fun AppNavigation(navController: NavHostController, viewModel: GunduAtaViewModel) {
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
                        // TODO: Launch Unity Activity later
                    }
                },
                onNavigate = { route ->
                    if (route == "gundu_ata") {
                        // Handle Gundu Ata game launch
                        // TODO: Launch Unity Activity later
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
                        // Handle Gundu Ata game launch
                        // TODO: Launch Unity Activity later
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
                title = "Transaction History",
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("deposits_record") {
            TransactionHistoryScreen(
                title = "Deposit record",
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("withdrawals_record") {
            TransactionHistoryScreen(
                title = "Withdrawal record",
                viewModel = viewModel,
                onBack = { navController.popBackStack() }
            )
        }
        composable("betting_record") {
            TransactionHistoryScreen(
                title = "Betting record",
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
