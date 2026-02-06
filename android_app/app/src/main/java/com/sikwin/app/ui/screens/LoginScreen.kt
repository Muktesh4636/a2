package com.sikwin.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikwin.app.ui.theme.*

import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    viewModel: GunduAtaViewModel,
    onLoginSuccess: () -> Unit,
    onNavigateToSignUp: () -> Unit
) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }

    LaunchedEffect(viewModel.loginSuccess) {
        if (viewModel.loginSuccess) {
            onLoginSuccess()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BlackBackground)
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        if (viewModel.isLoading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = PrimaryYellow)
        }
        
        viewModel.errorMessage?.let {
            Text(it, color = RedError, fontSize = 12.sp, modifier = Modifier.padding(vertical = 8.dp))
        }

        Spacer(modifier = Modifier.height(40.dp))
        
        // Header
        Text(
            text = "Welcome back",
            style = MaterialTheme.typography.headlineMedium,
            color = TextWhite,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.Start)
        )
        Text(
            text = "Please enter your username & password to log in",
            style = MaterialTheme.typography.bodyMedium,
            color = TextGrey,
            modifier = Modifier.align(Alignment.Start)
        )
        
        Spacer(modifier = Modifier.height(40.dp))

        // Username
        Text(
            text = "Username or Phone Number",
            color = TextWhite,
            fontSize = 14.sp,
            modifier = Modifier.align(Alignment.Start).padding(bottom = 8.dp)
        )
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Username or Phone Number", color = TextGrey) },
            leadingIcon = { Icon(Icons.Default.Person, contentDescription = null, tint = TextGrey) },
            colors = TextFieldDefaults.outlinedTextFieldColors(
                focusedBorderColor = PrimaryYellow,
                unfocusedBorderColor = BorderColor,
                containerColor = SurfaceColor,
                focusedTextColor = TextWhite,
                unfocusedTextColor = TextWhite
            ),
            shape = RoundedCornerShape(8.dp),
            singleLine = true
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Password
        Text(
            text = "Password",
            color = TextWhite,
            fontSize = 14.sp,
            modifier = Modifier.align(Alignment.Start).padding(bottom = 8.dp)
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Please enter your password", color = TextGrey) },
            leadingIcon = { Icon(Icons.Default.Lock, contentDescription = null, tint = TextGrey) },
            trailingIcon = {
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        imageVector = if (passwordVisible) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                        contentDescription = null,
                        tint = TextGrey
                    )
                }
            },
            visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
            colors = TextFieldDefaults.outlinedTextFieldColors(
                focusedBorderColor = PrimaryYellow,
                unfocusedBorderColor = BorderColor,
                containerColor = SurfaceColor,
                focusedTextColor = TextWhite,
                unfocusedTextColor = TextWhite
            ),
            shape = RoundedCornerShape(8.dp),
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password)
        )

        Spacer(modifier = Modifier.height(20.dp))

        // Sign-in Button
        Button(
            onClick = { viewModel.login(username, password) },
            enabled = !viewModel.isLoading,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            colors = ButtonDefaults.buttonColors(containerColor = PrimaryYellow),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Sign-in", color = BlackBackground, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Sign-up Button
        OutlinedButton(
            onClick = onNavigateToSignUp,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            border = BorderStroke(1.dp, PrimaryYellow),
            shape = RoundedCornerShape(8.dp)
        ) {
            Text("Sign-up", color = PrimaryYellow, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        }

        Spacer(modifier = Modifier.height(24.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            TextButton(onClick = { /* Forgot account */ }) {
                Text("Forgot account", color = TextGrey)
            }
            TextButton(onClick = { /* Forgot password */ }) {
                Text("Forgot password", color = TextGrey)
            }
        }
    }
}
