package com.porizo.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val Canvas = Color(0xFFFFF7F1)
private val Ink = Color(0xFF2C2420)
private val Muted = Color(0xFF766C65)
private val Coral = Color(0xFFD8643F)
private val Gold = Color(0xFFE2A83B)

@Composable
fun AppRoot() {
    MaterialTheme {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Canvas,
            contentColor = Ink
        ) {
            Column(modifier = Modifier.fillMaxSize()) {
                NativeHomeShell(modifier = Modifier.weight(1f))
                NativeNavigationBar()
            }
        }
    }
}

@Composable
private fun NativeHomeShell(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.Start
    ) {
        Icon(
            imageVector = Icons.Filled.CardGiftcard,
            contentDescription = null,
            tint = Coral,
            modifier = Modifier.size(44.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        FrauncesText(
            text = "Porizo",
            size = 42,
            modifier = Modifier.semantics { heading() }
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Native Android shell",
            color = Muted,
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(modifier = Modifier.height(20.dp))
        Text(
            text = "Skip has been removed from the app launch path. The next slices port auth, onboarding, library, claim, create, billing, push, and storage into Kotlin modules.",
            color = Ink,
            style = MaterialTheme.typography.bodyLarge,
            lineHeight = 24.sp
        )
    }
}

@Composable
private fun NativeNavigationBar() {
    NavigationBar(
        containerColor = Color.White,
        contentColor = Ink,
        modifier = Modifier.background(Color.White)
    ) {
        val items = listOf(
            "Create" to Icons.Filled.MusicNote,
            "Songs" to Icons.Filled.LibraryMusic,
            "Claim" to Icons.Filled.CardGiftcard,
            "Settings" to Icons.Filled.Settings
        )
        items.forEachIndexed { index, item ->
            NavigationBarItem(
                selected = index == 0,
                onClick = {},
                icon = { Icon(imageVector = item.second, contentDescription = null) },
                label = { Text(item.first) }
            )
        }
    }
}

@Composable
private fun FrauncesText(
    text: String,
    size: Int,
    modifier: Modifier = Modifier
) {
    Text(
        text = text,
        modifier = modifier,
        color = Ink,
        style = TextStyle(
            fontFamily = FontFamily(Font(R.font.fraunces_bold)),
            fontWeight = FontWeight.Bold,
            fontSize = size.sp,
            lineHeight = (size + 4).sp
        )
    )
}

@Preview(showBackground = true)
@Composable
private fun AppRootPreview() {
    AppRoot()
}
