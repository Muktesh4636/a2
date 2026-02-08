package com.sikwin.app.ui.screens

import kotlinx.coroutines.delay
import kotlin.time.Duration.Companion.seconds
import android.net.Uri
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.runtime.*
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import coil.compose.AsyncImage
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikwin.app.ui.theme.*
import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PaymentScreen(
    amount: String,
    viewModel: GunduAtaViewModel,
    onBack: () -> Unit,
    onSubmitSuccess: () -> Unit
) {
    var selectedImageUri by remember { mutableStateOf<Uri?>(null) }
    var selectedMethod by remember { mutableStateOf("Paytm") }
    
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        selectedImageUri = uri
    }
    val context = LocalContext.current
    
    // Timer state: 10 minutes = 600 seconds
    var timeLeftSeconds by remember { mutableIntStateOf(600) }

    LaunchedEffect(timeLeftSeconds) {
        if (timeLeftSeconds > 0) {
            delay(1000L)
            timeLeftSeconds--
        } else {
            // Redirect to deposit page when timer hits 0
            onBack()
        }
    }

    // Format seconds to MM:SS
    val timeLeft = remember(timeLeftSeconds) {
        val minutes = timeLeftSeconds / 60
        val seconds = timeLeftSeconds % 60
        String.format("%02d:%02d", minutes, seconds)
    }

    LaunchedEffect(Unit) {
        viewModel.fetchPaymentMethods()
        viewModel.clearError()
    }

    fun openUpiApp(packageName: String?, specificUpiId: String?) {
        val upiId = specificUpiId ?: viewModel.paymentMethods.firstOrNull { !it.upi_id.isNullOrBlank() }?.upi_id 
        
        if (upiId.isNullOrBlank()) {
            Toast.makeText(context, "No UPI ID available for payment", Toast.LENGTH_SHORT).show()
            return
        }

        val upiUri = "upi://pay?pa=$upiId&pn=GunduAta&am=$amount&cu=INR"
        
        val intent = Intent(Intent.ACTION_VIEW)
        intent.data = Uri.parse(upiUri)
        
        if (packageName != null) {
            intent.setPackage(packageName)
        }

        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(context, "App not installed", Toast.LENGTH_SHORT).show()
            // If specific app fails, try opening with chooser
            if (packageName != null) {
                val chooserIntent = Intent(Intent.ACTION_VIEW)
                chooserIntent.data = Uri.parse(upiUri)
                context.startActivity(Intent.createChooser(chooserIntent, "Pay with"))
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F5)) // Light background like in image
            .verticalScroll(rememberScrollState())
    ) {
        // Top Bar
        Surface(
            color = Color(0xFF3F51B5), // Blue header like in image
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, null, tint = Color.White)
                }
                Text(
                    "Payment",
                    color = Color.White,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    textAlign = TextAlign.Center
                )
                Text(
                    timeLeft,
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                "Amount Payable",
                color = Color.Black,
                fontSize = 18.sp
            )
            Text(
                "₹$amount",
                color = Color(0xFF0022AA), // Deep blue for amount
                fontSize = 36.sp,
                fontWeight = FontWeight.ExtraBold,
                modifier = Modifier.padding(vertical = 8.dp)
            )

            Text(
                "Please fill in UTR after successful payment",
                color = Color.Black,
                fontSize = 14.sp,
                textAlign = TextAlign.Center
            )
            Text(
                "Use Mobile Scan QR To Pay",
                color = Color.Black,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(top = 4.dp, bottom = 16.dp)
            )

            // QR Code Placeholder
            Surface(
                modifier = Modifier
                    .size(200.dp)
                    .border(1.dp, Color.LightGray),
                color = Color.White
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    // This would be the actual QR code image
                    Icon(
                        Icons.Default.QrCode2,
                        contentDescription = "QR Code",
                        modifier = Modifier.size(150.dp),
                        tint = Color.Black
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            Button(
                onClick = { /* Save QR code logic */ },
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3F51B5)),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.width(120.dp)
            ) {
                Text("Save", color = Color.White)
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Payment Methods Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                shape = RoundedCornerShape(12.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "Choose a payment method to pay",
                        color = Color.Black,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )

                    val activeMethods = viewModel.paymentMethods.filter { it.is_active }
                    
                    if (activeMethods.isEmpty()) {
                        Text(
                            "No payment methods available",
                            color = Color.Gray,
                            modifier = Modifier.padding(8.dp),
                            style = androidx.compose.ui.text.TextStyle(fontSize = 14.sp)
                        )
                    } else {
                        // Sort so preferred ones are on top if needed, or keeping backend order
                        activeMethods.forEach { method ->
                            val icon = getPaymentIcon(method.name)
                            PaymentMethodItem(
                                name = method.name,
                                icon = icon,
                                isSelected = selectedMethod == method.name,
                                onClick = { 
                                    selectedMethod = method.name
                                    // Identify package based on name
                                    val packageName = getPaymentPackage(method.name)
                                    // Use specific UPI ID if available
                                    if (!method.upi_id.isNullOrBlank()) {
                                        openUpiApp(packageName, method.upi_id)
                                    } else {
                                        // Fallback for non-UPI or if UPI ID missing
                                        // If it's a Bank method, maybe show a toast or dialog with details
                                        if (method.type == "BANK") {
                                            Toast.makeText(context, "Please use Bank Transfer details", Toast.LENGTH_SHORT).show()
                                        } else {
                                            Toast.makeText(context, "No UPI ID for this method", Toast.LENGTH_SHORT).show()
                                        }
                                    }
                                }
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // Screenshot Section
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "Paid? Upload Payment Screenshot",
                    color = Color.Black,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.width(4.dp))
                Icon(
                    Icons.Default.HelpOutline,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = Color(0xFF3F51B5)
                )
                Text(
                    "Guide",
                    color = Color(0xFF3F51B5),
                    fontSize = 14.sp,
                    modifier = Modifier.padding(start = 2.dp)
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Image Picker Area
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .border(1.dp, Color.LightGray, RoundedCornerShape(8.dp))
                    .clickable { launcher.launch("image/*") },
                color = Color.White
            ) {
                if (selectedImageUri != null) {
                    AsyncImage(
                        model = selectedImageUri,
                        contentDescription = "Payment Screenshot",
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit
                    )
                } else {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Icon(
                            Icons.Default.AddPhotoAlternate,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = Color.Gray
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Click to select payment screenshot", color = Color.Gray)
                    }
                }
            }

            if (selectedImageUri != null) {
                TextButton(
                    onClick = { selectedImageUri = null },
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text("Clear", color = Color.Red)
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Button(
                onClick = { 
                    selectedImageUri?.let { uri ->
                        viewModel.uploadDepositProof(amount, uri, context, onSubmitSuccess)
                    }
                },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3F51B5)),
                shape = RoundedCornerShape(8.dp),
                enabled = !viewModel.isLoading && selectedImageUri != null
            ) {
                if (viewModel.isLoading) {
                    CircularProgressIndicator(color = Color.White, modifier = Modifier.size(24.dp))
                } else {
                    Text("Submit Payment Proof", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                }
            }
            
            if (viewModel.errorMessage != null) {
                Text(
                    viewModel.errorMessage!!,
                    color = Color.Red,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}

@Composable
fun PaymentMethodItem(
    name: String,
    icon: ImageVector,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = if (isSelected) Color(0xFFF0F2FF) else Color(0xFFFAFAFA),
        shape = RoundedCornerShape(8.dp),
        border = if (isSelected) BorderStroke(1.dp, Color(0xFF3F51B5)) else null,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            val iconColor = when {
                name.contains("Paytm", ignoreCase = true) -> Color(0xFF00BAF2)
                name.contains("PhonePe", ignoreCase = true) -> Color(0xFF5F259F)
                name.contains("Google", ignoreCase = true) -> Color(0xFF4285F4)
                else -> Color.Gray
            }
            Icon(icon, null, tint = iconColor, modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.width(12.dp))
            Text(
                name,
                color = Color.Black,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            Icon(
                Icons.Default.TouchApp,
                contentDescription = null,
                tint = Color(0xFF3F51B5),
                modifier = Modifier.size(24.dp)
            )
        }
    }
}

// Helpers
private fun getPaymentIcon(name: String): ImageVector {
    return when {
        name.contains("Paytm", ignoreCase = true) -> Icons.Default.Payments
        name.contains("PhonePe", ignoreCase = true) -> Icons.Default.AccountBalanceWallet
        name.contains("Google", ignoreCase = true) -> Icons.Default.AccountBalance
        name.contains("Bhim", ignoreCase = true) -> Icons.Default.QrCode
        else -> Icons.Default.Payment
    }
}

private fun getPaymentPackage(name: String): String? {
    return when {
        name.contains("Paytm", ignoreCase = true) -> "net.one97.paytm"
        name.contains("PhonePe", ignoreCase = true) -> "com.phonepe.app"
        name.contains("Google", ignoreCase = true) -> "com.google.android.apps.nbu.paisa.user"
        name.contains("Bhim", ignoreCase = true) -> "in.org.npci.upiapp"
        else -> null 
    }
}
