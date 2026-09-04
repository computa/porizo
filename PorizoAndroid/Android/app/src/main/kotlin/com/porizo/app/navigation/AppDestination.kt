package com.porizo.app.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.ui.graphics.vector.ImageVector
import com.porizo.core.ui.PorizoTabItem

enum class AppTab(
    val label: String,
    val icon: ImageVector,
    val contentDescription: String,
) {
    Home("Home", Icons.Filled.Home, "Home tab"),
    Songs("Songs", Icons.Filled.LibraryMusic, "Songs tab"),
    Poems("Poems", Icons.Filled.Edit, "Poems tab"),
    Settings("Settings", Icons.Filled.Settings, "Settings tab"),
}

fun AppTab.toTabItem(): PorizoTabItem<AppTab> =
    PorizoTabItem(
        value = this,
        label = label,
        icon = icon,
        contentDescription = contentDescription,
    )
