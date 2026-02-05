package com.sikwin.app.ui.viewmodels

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.sikwin.app.data.api.RetrofitClient
import com.sikwin.app.data.auth.SessionManager
import com.sikwin.app.data.models.*
import kotlinx.coroutines.launch

class GunduAtaViewModel(private val sessionManager: SessionManager) : ViewModel() {

    var isLoading by mutableStateOf(false)
    var errorMessage by mutableStateOf<String?>(null)
    
    var userProfile by mutableStateOf<User?>(null)
    var wallet by mutableStateOf<Wallet?>(null)
    var transactions by mutableStateOf<List<Transaction>>(emptyList())
    var depositRequests by mutableStateOf<List<DepositRequest>>(emptyList())
    var withdrawRequests by mutableStateOf<List<WithdrawRequest>>(emptyList())
    var paymentMethods by mutableStateOf<List<PaymentMethod>>(emptyList())
    var bankDetails by mutableStateOf<List<UserBankDetail>>(emptyList())
    
    var loginSuccess by mutableStateOf(false)
    
    init {
        // Auto-login if token exists
        if (sessionManager.fetchAuthToken() != null) {
            loginSuccess = true
            fetchProfile()
            fetchWallet()
        }
    }

    fun login(username: String, password: String) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = RetrofitClient.apiService.login(mapOf("username" to username, "password" to password))
                if (response.isSuccessful) {
                    val authResponse = response.body()
                    authResponse?.let {
                        sessionManager.saveAuthToken(it.access)
                        sessionManager.saveRefreshToken(it.refresh)
                        sessionManager.saveUsername(it.user.username)
                        userProfile = it.user
                        loginSuccess = true
                    }
                } else {
                    val errorBody = response.errorBody()?.string()
                    errorMessage = if (!errorBody.isNullOrEmpty()) {
                        "Login failed: $errorBody"
                    } else {
                        "Login failed: ${response.message()}"
                    }
                }
            } catch (e: Exception) {
                errorMessage = "Error: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    fun register(data: Map<String, String>) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = RetrofitClient.apiService.register(data)
                if (response.isSuccessful) {
                    val authResponse = response.body()
                    authResponse?.let {
                        sessionManager.saveAuthToken(it.access)
                        sessionManager.saveRefreshToken(it.refresh)
                        sessionManager.saveUsername(it.user.username)
                        userProfile = it.user
                        loginSuccess = true
                    }
                } else {
                    errorMessage = "Registration failed: ${response.message()}"
                }
            } catch (e: Exception) {
                errorMessage = "Error: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    fun fetchProfile() {
        viewModelScope.launch {
            try {
                val response = RetrofitClient.apiService.getProfile()
                if (response.isSuccessful) {
                    userProfile = response.body()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            }
        }
    }

    fun fetchWallet() {
        viewModelScope.launch {
            try {
                val response = RetrofitClient.apiService.getWallet()
                if (response.isSuccessful) {
                    wallet = response.body()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            }
        }
    }

    fun fetchTransactions() {
        viewModelScope.launch {
            isLoading = true
            try {
                val response = RetrofitClient.apiService.getTransactions()
                if (response.isSuccessful) {
                    transactions = response.body() ?: emptyList()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            } finally {
                isLoading = false
            }
        }
    }

    fun fetchDeposits() {
        viewModelScope.launch {
            isLoading = true
            try {
                val response = RetrofitClient.apiService.getMyDeposits()
                if (response.isSuccessful) {
                    depositRequests = response.body() ?: emptyList()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            } finally {
                isLoading = false
            }
        }
    }

    fun fetchWithdrawals() {
        viewModelScope.launch {
            isLoading = true
            try {
                val response = RetrofitClient.apiService.getMyWithdrawals()
                if (response.isSuccessful) {
                    withdrawRequests = response.body() ?: emptyList()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            } finally {
                isLoading = false
            }
        }
    }

    fun fetchPaymentMethods() {
        viewModelScope.launch {
            try {
                val response = RetrofitClient.apiService.getPaymentMethods()
                if (response.isSuccessful) {
                    paymentMethods = response.body() ?: emptyList()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            }
        }
    }

    fun fetchBankDetails() {
        viewModelScope.launch {
            isLoading = true
            try {
                val response = RetrofitClient.apiService.getBankDetails()
                if (response.isSuccessful) {
                    bankDetails = response.body() ?: emptyList()
                }
            } catch (e: Exception) {
                errorMessage = e.message
            } finally {
                isLoading = false
            }
        }
    }

    fun addBankDetail(data: Map<String, Any>, onSuccess: () -> Unit) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = RetrofitClient.apiService.addBankDetail(data)
                if (response.isSuccessful) {
                    fetchBankDetails()
                    onSuccess()
                } else {
                    errorMessage = "Failed to add bank detail: ${response.message()}"
                }
            } catch (e: Exception) {
                errorMessage = "Error: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    fun submitUtr(amount: String, utr: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = RetrofitClient.apiService.submitUtr(mapOf("amount" to amount, "utr" to utr))
                if (response.isSuccessful) {
                    onSuccess()
                } else {
                    errorMessage = "Failed to submit UTR: ${response.message()}"
                }
            } catch (e: Exception) {
                errorMessage = "Error: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    fun updateUsername(newUsername: String) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = RetrofitClient.apiService.updateProfile(mapOf("username" to newUsername))
                if (response.isSuccessful) {
                    userProfile = response.body()
                    sessionManager.saveUsername(newUsername)
                } else {
                    errorMessage = "Failed to update username: ${response.message()}"
                }
            } catch (e: Exception) {
                errorMessage = "Error: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }

    fun updateProfilePhoto(photo: okhttp3.MultipartBody.Part) {
        viewModelScope.launch {
            isLoading = true
            errorMessage = null
            try {
                val response = RetrofitClient.apiService.updateProfilePhoto(photo)
                if (response.isSuccessful) {
                    userProfile = response.body()
                } else {
                    errorMessage = "Failed to update photo: ${response.message()}"
                }
            } catch (e: Exception) {
                errorMessage = "Error: ${e.message}"
            } finally {
                isLoading = false
            }
        }
    }
    
    fun logout() {
        sessionManager.logout()
        userProfile = null
        wallet = null
        loginSuccess = false
    }
}
