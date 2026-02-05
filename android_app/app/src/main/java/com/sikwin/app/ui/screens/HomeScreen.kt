package com.sikwin.app.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import com.sikwin.app.R
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikwin.app.ui.theme.*

import com.sikwin.app.ui.viewmodels.GunduAtaViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: GunduAtaViewModel,
    onGameClick: (String) -> Unit,
    onNavigate: (String) -> Unit
) {
    LaunchedEffect(Unit) {
        viewModel.fetchWallet()
    }

    Scaffold(
        topBar = { 
            HomeTopBar(
                balance = viewModel.wallet?.balance ?: "0.00",
                onWalletClick = { onNavigate("wallet") }
            ) 
        },
        bottomBar = { HomeBottomNavigation(currentRoute = "home", onNavigate = onNavigate) },
        containerColor = BlackBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            // Search Bar
            SearchBar()
            
            // Banners
            PromotionalBanners(onSpinClick = { /* Disabled navigation */ })
            
            // Hot Games
            SectionHeader(title = "Hot games")
            HotGamesGrid(onGameClick)
            
            Spacer(modifier = Modifier.height(20.dp))
        }
    }
}

@Composable
fun HomeTopBar(balance: String, onWalletClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(BlackBackground)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically
        ) {
            Image(
                painter = painterResource(id = R.drawable.app_logo),
                contentDescription = "App Logo",
                modifier = Modifier
                    .size(40.dp)
                    .clip(RoundedCornerShape(8.dp))
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Gundu Ata",
                color = TextWhite,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
        }
        
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Balance Pill
            Surface(
                color = SurfaceColor,
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier
                    .padding(end = 12.dp)
                    .clickable { onWalletClick() }
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("₹", color = PrimaryYellow, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(balance, color = TextWhite, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.width(8.dp))
                    Icon(
                        Icons.Default.AddBox,
                        contentDescription = null,
                        tint = PrimaryYellow,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchBar() {
    OutlinedTextField(
        value = "",
        onValueChange = {},
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        placeholder = { Text("Search", color = TextGrey) },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = TextWhite) },
        colors = TextFieldDefaults.outlinedTextFieldColors(
            containerColor = SurfaceColor,
            unfocusedBorderColor = Color.Transparent,
            focusedBorderColor = PrimaryYellow,
            focusedTextColor = TextWhite,
            unfocusedTextColor = TextWhite
        ),
        shape = RoundedCornerShape(12.dp),
        singleLine = true
    )
}

@Composable
fun PromotionalBanners(onSpinClick: () -> Unit) {
    // Simplified banner
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(180.dp)
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(
                Brush.horizontalGradient(listOf(Color(0xFF4A148C), Color(0xFF880E4F)))
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("GET LUCKY DRAW", color = PrimaryYellow, fontWeight = FontWeight.ExtraBold, fontSize = 24.sp)
            Text("WITH BANK TRANSFER", color = TextWhite, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(12.dp))
            Button(
                onClick = onSpinClick,
                colors = ButtonDefaults.buttonColors(containerColor = PrimaryYellow),
                shape = RoundedCornerShape(20.dp)
            ) {
                Text("SPIN", color = BlackBackground, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun SectionHeader(title: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(title, color = TextWhite, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Row {
            Icon(Icons.Default.ArrowBack, null, tint = TextGrey, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.width(8.dp))
            Icon(Icons.Default.ArrowForward, null, tint = TextWhite, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
fun HotGamesGrid(onGameClick: (String) -> Unit) {
    // Grid for hot games - Only Gundu Ata
    val games = listOf(
        GameItem("Gundu Ata", "gundu_ata", Color(0xFF1565C0))
    )
    
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.Center
    ) {
        games.forEach { game ->
            GameCard(game, Modifier.fillMaxWidth(0.5f), onGameClick)
        }
    }
}

data class GameItem(val name: String, val id: String, val color: Color)

@Composable
fun GameCard(game: GameItem, modifier: Modifier, onGameClick: (String) -> Unit) {
    Column(
        modifier = modifier.clickable { onGameClick(game.id) },
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Box(
            modifier = Modifier
                .aspectRatio(0.7f)
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(game.color),
            contentAlignment = Alignment.BottomCenter
        ) {
            Image(
                painter = painterResource(id = R.drawable.gundu_ata_bg),
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            
            Text(
                game.name,
                color = TextWhite,
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                modifier = Modifier.padding(bottom = 20.dp)
            )
        }
        Spacer(modifier = Modifier.height(8.dp))
        Text(game.name.lowercase(), color = TextGrey, fontSize = 14.sp)
    }
}

@Composable
fun RelatedGamesList() {
    LazyRow(
        modifier = Modifier.padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        items(3) {
            Box(
                modifier = Modifier
                    .width(300.dp)
                    .height(150.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(SurfaceColor)
            )
        }
    }
}

@Composable
fun HomeBottomNavigation(currentRoute: String, onNavigate: (String) -> Unit) {
    NavigationBar(
        containerColor = BottomNavBackground,
        tonalElevation = 8.dp
    ) {
        val items = listOf(
            BottomNavItem("Home", "home", Icons.Default.Home),
            BottomNavItem("Gundu Ata", "gundu_ata", Icons.Default.Casino),
            BottomNavItem("Me", "me", Icons.Default.AccountCircle)
        )
        
        items.forEach { item ->
            NavigationBarItem(
                selected = currentRoute == item.route,
                onClick = { onNavigate(item.route) },
                icon = { Icon(item.icon, contentDescription = null) },
                label = { Text(item.name) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = PrimaryYellow,
                    selectedTextColor = PrimaryYellow,
                    unselectedIconColor = TextGrey,
                    unselectedTextColor = TextGrey,
                    indicatorColor = Color.Transparent
                )
            )
        }
    }
}

data class BottomNavItem(val name: String, val route: String, val icon: ImageVector)
