package com.sikwin.app.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikwin.app.ui.theme.*
import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@Composable
fun SecurityScreen(
    viewModel: GunduAtaViewModel,
    onBack: () -> Unit
) {
    LaunchedEffect(Unit) {
        viewModel.fetchProfile()
    }

    val user = viewModel.userProfile

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BlackBackground)
    ) {
        // Header
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.align(Alignment.CenterStart)
            ) {
                Icon(
                    Icons.Default.ArrowBack,
                    contentDescription = "Back",
                    tint = TextWhite,
                    modifier = Modifier.size(28.dp)
                )
            }
            Text(
                "Security",
                color = PrimaryYellow,
                fontSize = 20.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.align(Alignment.Center)
            )
        }

        // Security Items
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
        ) {
            SecurityItem(
                label = "Email",
                action = "Verify Now",
                onClick = { /* TODO: Implement email verification */ }
            )
            HorizontalDivider(color = BorderColor, thickness = 0.5.dp)

            SecurityItem(
                label = "Password",
                action = "Change",
                onClick = { /* TODO: Implement password change */ }
            )
            HorizontalDivider(color = BorderColor, thickness = 0.5.dp)

            SecurityItem(
                label = "Withdrawal Password:",
                action = "Setting",
                onClick = { /* TODO: Implement withdrawal password */ }
            )
            HorizontalDivider(color = BorderColor, thickness = 0.5.dp)

            SecurityItem(
                label = "Phone",
                value = user?.phone_number?.let { maskPhoneNumber(it) } ?: "",
                onClick = { /* TODO: Implement phone verification */ }
            )
            HorizontalDivider(color = BorderColor, thickness = 0.5.dp)

            SecurityItem(
                label = "Real name",
                action = "Verify Now",
                onClick = { /* TODO: Implement real name verification */ }
            )
        }
    }
}

@Composable
fun SecurityItem(
    label: String,
    action: String? = null,
    value: String? = null,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .padding(vertical = 20.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = label,
            color = TextGrey,
            fontSize = 16.sp
        )
        
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.End
        ) {
            if (value != null) {
                Text(
                    text = value,
                    color = TextGrey,
                    fontSize = 14.sp
                )
            } else if (action != null) {
                Text(
                    text = action,
                    color = TextGrey,
                    fontSize = 14.sp
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Icon(
                Icons.Default.ArrowForward,
                contentDescription = null,
                tint = TextGrey,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}
