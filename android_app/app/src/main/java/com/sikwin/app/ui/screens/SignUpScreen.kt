package com.sikwin.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignUpScreen(
    viewModel: GunduAtaViewModel,
    onSignUpSuccess: () -> Unit,
    onNavigateToSignIn: () -> Unit
) {
    var username by remember { mutableStateOf("9182351381") }
    var password by remember { mutableStateOf("123456789") }
    var phoneNumber by remember { mutableStateOf("9182351381") }
    var otpCode by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    LaunchedEffect(viewModel.loginSuccess) {
        if (viewModel.loginSuccess) {
            onSignUpSuccess()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BlackBackground)
            .padding(16.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (viewModel.isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = PrimaryYellow)
        }
        
        viewModel.errorMessage?.let {
            Text(it, color = RedError, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
        }

        Row(modifier = Modifier.fillMaxWidth()) {
            IconButton(onClick = onNavigateToSignIn) {
                Icon(Icons.Default.ArrowBack, null, tint = TextWhite)
            }
        }
        
        Spacer(modifier = Modifier.height(20.dp))
        
        Text(
            text = "Sign up",
            style = MaterialTheme.typography.headlineLarge,
            color = TextWhite,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Start)
        )
        Text(
            text = "Welcome to Gundu Ata",
            style = MaterialTheme.typography.bodyMedium,
            color = TextGrey,
            modifier = Modifier.align(Alignment.Start)
        )
        
        Spacer(modifier = Modifier.height(40.dp))

        // Username
        InputFieldLabel("Username")
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Please enter your username", color = TextGrey) },
            leadingIcon = { Icon(Icons.Default.Person, null, tint = TextGrey) },
            colors = TextFieldDefaults.outlinedTextFieldColors(
                containerColor = SurfaceColor,
                unfocusedBorderColor = BorderColor,
                focusedBorderColor = PrimaryYellow,
                focusedTextColor = TextWhite,
                unfocusedTextColor = TextWhite
            ),
            shape = RoundedCornerShape(8.dp),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Password
        InputFieldLabel("Password")
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Please enter your password", color = TextGrey) },
            leadingIcon = { Icon(Icons.Default.Lock, null, tint = TextGrey) },
            trailingIcon = {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        imageVector = if (passwordVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                        null,
                        tint = TextGrey
                    )
                }
            },
            colors = TextFieldDefaults.outlinedTextFieldColors(
                containerColor = SurfaceColor,
                unfocusedBorderColor = BorderColor,
                focusedBorderColor = PrimaryYellow,
                focusedTextColor = TextWhite,
                unfocusedTextColor = TextWhite
            ),
            shape = RoundedCornerShape(8.dp),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Phone Number
        InputFieldLabel("Phone number")
        OutlinedTextField(
            value = phoneNumber,
            onValueChange = { phoneNumber = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Please enter your phone number", color = TextGrey) },
            leadingIcon = { Text("+91", color = TextWhite, modifier = Modifier.padding(start = 12.dp)) },
            colors = TextFieldDefaults.outlinedTextFieldColors(
                containerColor = SurfaceColor,
                unfocusedBorderColor = BorderColor,
                focusedBorderColor = PrimaryYellow,
                focusedTextColor = TextWhite,
                unfocusedTextColor = TextWhite
            ),
            shape = RoundedCornerShape(8.dp),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(20.dp))

        // OTP Code
        InputFieldLabel("OTP code")
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = otpCode,
                onValueChange = { otpCode = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("OTP code", color = TextGrey) },
                leadingIcon = { Icon(Icons.Default.VerifiedUser, null, tint = TextGrey) },
                colors = TextFieldDefaults.outlinedTextFieldColors(
                    containerColor = SurfaceColor,
                    unfocusedBorderColor = BorderColor,
                    focusedBorderColor = PrimaryYellow
                ),
                shape = RoundedCornerShape(8.dp),
                singleLine = true
            )
            TextButton(onClick = { /* Get OTP */ }) {
                Text("Get OTP Code", color = TextGrey)
            }
        }

        Spacer(modifier = Modifier.height(40.dp))

        Button(
            onClick = { 
                viewModel.register(mapOf(
                    "username" to username,
                    "password" to password,
                    "password2" to password,
                    "phone_number" to phoneNumber
                ))
            },
            enabled = !viewModel.isLoading,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = PrimaryYellow),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Sign-up", color = BlackBackground, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Spacer(modifier = Modifier.height(12.dp))

        OutlinedButton(
            onClick = onNavigateToSignIn,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            border = BorderStroke(1.dp, PrimaryYellow),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Sign-in", color = PrimaryYellow, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }
    }
}

@Composable
fun InputFieldLabel(text: String) {
    Text(
        text = text,
        color = TextWhite,
        fontSize = 14.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
    )
}
