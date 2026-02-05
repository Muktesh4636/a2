package com.sikwin.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikwin.app.ui.theme.*
import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WithdrawalAccountScreen(
    viewModel: GunduAtaViewModel,
    onBack: () -> Unit,
    onAddBankAccount: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(0) }
    val tabs = listOf("Bank Account", "Digital Wallets")

    LaunchedEffect(Unit) {
        viewModel.fetchBankDetails()
    }

    Scaffold(
        containerColor = BlackBackground,
        topBar = {
            CenterAlignedTopAppBar(
                title = {
                    Text(
                        "My Withdrawal Account",
                        color = Color(0xFFDAA520),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Medium
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            contentDescription = "Back",
                            tint = Color(0xFFDAA520),
                            modifier = Modifier.size(32.dp)
                        )
                    }
                },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                    containerColor = BlackBackground
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Tabs
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceAround
            ) {
                tabs.forEachIndexed { index, title ->
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .clickable { selectedTab = index }
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = title,
                            color = if (selectedTab == index) PrimaryYellow else TextGrey,
                            fontSize = 16.sp,
                            fontWeight = if (selectedTab == index) FontWeight.Bold else FontWeight.Normal
                        )
                        if (selectedTab == index) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Box(
                                modifier = Modifier
                                    .width(60.dp)
                                    .height(2.dp)
                                    .background(PrimaryYellow)
                            )
                        } else {
                            Spacer(modifier = Modifier.height(6.dp)) // To keep text aligned
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (selectedTab == 0) {
                // Bank Accounts List
                LazyColumn(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    items(viewModel.bankDetails) { bank ->
                        BankCard(
                            bankName = bank.bank_name,
                            accountName = bank.account_name,
                            accountNumber = bank.account_number,
                            ifsc = bank.ifsc_code,
                            isDefault = bank.is_default,
                            onDelete = { /* Logic to delete if needed */ }
                        )
                    }

                    item {
                        if (viewModel.bankDetails.isEmpty() && !viewModel.isLoading) {
                            Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                Text(
                                    "No bank accounts added yet",
                                    color = TextGrey,
                                    fontSize = 14.sp
                                )
                            }
                        }
                        
                        if (viewModel.isLoading) {
                            Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = PrimaryYellow)
                            }
                        }
                    }
                }

                // Add Button
                Button(
                    onClick = onAddBankAccount,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 32.dp, start = 16.dp, end = 16.dp)
                        .height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryYellow),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Text(
                        "add bank account number",
                        color = BlackBackground,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            } else {
                // Digital Wallets Placeholder
                Box(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    Text("Digital Wallets coming soon", color = TextGrey)
                }
            }
        }
    }
}

@Composable
fun BankCard(
    bankName: String,
    accountName: String,
    accountNumber: String,
    ifsc: String,
    isDefault: Boolean,
    onDelete: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFFE6B84D), // Goldish
                        Color(0xFFC48B22)  // Darker Gold
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Top
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = bankName,
                        color = Color.White,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1
                    )
                    Text(
                        text = accountName,
                        color = Color.White.copy(alpha = 0.8f),
                        fontSize = 16.sp
                    )
                }
                
                IconButton(
                    onClick = onDelete,
                    modifier = Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(Color.White)
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = "Delete",
                        tint = Color.Black,
                        modifier = Modifier.size(16.dp)
                    )
                }
            }

            // Masked Account Number
            Row(
                modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val masked = if (accountNumber.length > 4) {
                    "****  ****  ****  ${accountNumber.takeLast(4)}"
                } else {
                    accountNumber
                }
                Text(
                    text = masked,
                    color = Color.White,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Medium
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.Bottom
            ) {
                Text(
                    text = if (isDefault) "Set as default" else "Not default",
                    color = Color.White.copy(alpha = 0.7f),
                    fontSize = 14.sp
                )
                Text(
                    text = "IFSC : $ifsc",
                    color = Color.White,
                    fontSize = 14.sp
                )
            }
        }
    }
}
