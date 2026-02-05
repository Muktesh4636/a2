package com.sikwin.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
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

@Composable
fun TransactionHistoryScreen(
    title: String = "Transaction History",
    viewModel: GunduAtaViewModel,
    onBack: () -> Unit
) {
    var selectedTab by remember { mutableStateOf("All") }
    val tabs = listOf("All", "Success", "Failed")

    LaunchedEffect(title) {
        when (title) {
            "Transaction History" -> viewModel.fetchTransactions()
            "Deposit record" -> viewModel.fetchDeposits()
            "Withdrawal record" -> viewModel.fetchWithdrawals()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BlackBackground)
    ) {
        // Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.Default.ArrowBack, null, tint = PrimaryYellow, modifier = Modifier.size(32.dp))
            }
            Text(
                title,
                color = PrimaryYellow,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Icon(Icons.Default.FilterList, null, tint = PrimaryYellow, modifier = Modifier.size(28.dp))
        }

        // Tabs
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            tabs.forEach { tab ->
                HistoryTab(tab, selectedTab == tab) { selectedTab = tab }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        // Date Filter
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = SurfaceColor,
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.weight(1f)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.History, null, tint = TextGrey, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("2026/02/05-2026/02/05", color = TextWhite, fontSize = 14.sp)
                }
            }
            Spacer(modifier = Modifier.width(12.dp))
            Button(
                onClick = { /* Search */ },
                colors = ButtonDefaults.buttonColors(containerColor = SurfaceColor),
                shape = RoundedCornerShape(20.dp),
                border = BorderStroke(1.dp, BorderColor)
            ) {
                Text("Search", color = TextGrey)
            }
        }

        val filteredDeposits = remember(viewModel.depositRequests, selectedTab) {
            when (selectedTab) {
                "Success" -> viewModel.depositRequests.filter { it.status == "APPROVED" }
                "Failed" -> viewModel.depositRequests.filter { it.status == "REJECTED" }
                else -> viewModel.depositRequests
            }
        }

        val filteredWithdrawals = remember(viewModel.withdrawRequests, selectedTab) {
            when (selectedTab) {
                "Success" -> viewModel.withdrawRequests.filter { it.status == "APPROVED" }
                "Failed" -> viewModel.withdrawRequests.filter { it.status == "REJECTED" }
                else -> viewModel.withdrawRequests
            }
        }

        val itemsCount = when (title) {
            "Transaction History" -> viewModel.transactions.size
            "Deposit record" -> filteredDeposits.size
            "Withdrawal record" -> filteredWithdrawals.size
            else -> 0
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.End
        ) {
            Text("Summary : ", color = TextWhite, fontSize = 14.sp)
            Text("$itemsCount", color = GreenSuccess, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }

        // Content / List
        if (viewModel.isLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = PrimaryYellow)
            }
        } else if (itemsCount > 0) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                when (title) {
                    "Transaction History" -> {
                        items(viewModel.transactions.size) { index ->
                            val tx = viewModel.transactions[index]
                            TransactionItem(tx.description, tx.amount, tx.created_at)
                        }
                    }
                    "Deposit record" -> {
                        items(filteredDeposits.size) { index ->
                            val dep = filteredDeposits[index]
                            TransactionItem("Deposit #${dep.id}", dep.amount, dep.created_at)
                        }
                    }
                    "Withdrawal record" -> {
                        items(filteredWithdrawals.size) { index ->
                            val wd = filteredWithdrawals[index]
                            TransactionItem("Withdrawal #${wd.id}", wd.amount, wd.created_at)
                        }
                    }
                }
            }
        } else {
            Column(
                modifier = Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text("No more", color = TextGrey, fontSize = 16.sp)
            }
        }
    }
}

@Composable
fun TransactionItem(title: String, amount: String, date: String) {
    Surface(
        color = SurfaceColor,
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(title, color = TextWhite, fontWeight = FontWeight.Bold)
                Text(date, color = TextGrey, fontSize = 12.sp)
            }
            Text("₹ $amount", color = PrimaryYellow, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun HistoryTab(text: String, isSelected: Boolean, onClick: () -> Unit) {
    Column(
        modifier = Modifier.clickable { onClick() },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = text,
            color = if (isSelected) PrimaryYellow else TextGrey,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
            fontSize = 14.sp,
            modifier = Modifier.padding(bottom = 8.dp)
        )
        if (isSelected) {
            Box(
                modifier = Modifier
                    .width(40.dp)
                    .height(3.dp)
                    .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp))
                    .background(
                        Brush.verticalGradient(listOf(PrimaryYellow, Color.Transparent))
                    )
            )
        }
    }
}
