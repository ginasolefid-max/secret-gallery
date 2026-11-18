package com.secretgallery.vault.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val VaultColors = darkColorScheme(
    primary = Color(0xFF14B8A6),
    onPrimary = Color(0xFF042F2E),
    secondary = Color(0xFF334155),
    onSecondary = Color(0xFFF8FAFC),
    background = Color(0xFF0B0E14),
    onBackground = Color(0xFFF1F5F9),
    surface = Color(0xFF121722),
    onSurface = Color(0xFFF1F5F9),
    surfaceVariant = Color(0xFF1B2333),
    onSurfaceVariant = Color(0xFF94A3B8),
    error = Color(0xFFEF4444),
    onError = Color(0xFFFFFFFF)
)

@Composable
fun SecretGalleryTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = VaultColors,
        content = content
    )
}
