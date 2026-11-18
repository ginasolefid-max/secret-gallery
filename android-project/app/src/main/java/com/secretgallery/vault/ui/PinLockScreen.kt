package com.secretgallery.vault.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable
fun PinLockScreen(
    isSetupMode: Boolean,
    recoveryQuestion: String?,
    lockoutSecondsInitial: Long,
    errorMessage: String?,
    onSetupComplete: (String) -> Unit,
    onUnlockAttempt: (String) -> Unit,
    onRecoverPin: (answer: String, newPin: String) -> Pair<Boolean, String?>
) {
    var enteredPin by remember { mutableStateOf("") }
    var firstSetupPin by remember { mutableStateOf<String?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }
    var lockoutRemaining by remember(lockoutSecondsInitial) { mutableIntStateOf(lockoutSecondsInitial.toInt()) }
    var showRecoveryDialog by remember { mutableStateOf(false) }

    LaunchedEffect(lockoutRemaining) {
        if (lockoutRemaining > 0) {
            delay(1000L)
            lockoutRemaining -= 1
        }
    }

    val title = when {
        !isSetupMode -> "Enter Vault PIN"
        firstSetupPin == null -> "Create Vault PIN"
        else -> "Confirm Vault PIN"
    }

    val subtitle = when {
        lockoutRemaining > 0 -> "Too many attempts. Try again in ${lockoutRemaining}s."
        localError != null -> localError!!
        errorMessage != null -> errorMessage
        isSetupMode && firstSetupPin == null -> "Choose 4 to 8 digits. Used to derive your AES-256 vault key."
        isSetupMode && firstSetupPin != null -> "Re-enter the same PIN to seal your vault."
        else -> "Protected with PBKDF2-SHA256 & Keystore encryption"
    }

    val hasError = lockoutRemaining > 0 || localError != null || errorMessage != null

    fun submitDigit(digit: String) {
        if (lockoutRemaining > 0 || enteredPin.length >= 8) return
        localError = null
        enteredPin += digit
    }

    fun submitAction() {
        if (lockoutRemaining > 0 || enteredPin.length < 4) {
            if (enteredPin.length < 4) localError = "PIN must be at least 4 digits."
            return
        }
        if (isSetupMode) {
            if (firstSetupPin == null) {
                firstSetupPin = enteredPin
                enteredPin = ""
            } else if (firstSetupPin == enteredPin) {
                val finalPin = enteredPin
                enteredPin = ""
                onSetupComplete(finalPin)
            } else {
                localError = "PINs did not match. Try again."
                firstSetupPin = null
                enteredPin = ""
            }
        } else {
            val attempt = enteredPin
            enteredPin = ""
            onUnlockAttempt(attempt)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(horizontal = 28.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(modifier = Modifier.height(16.dp))
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceVariant),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.Lock,
                    contentDescription = "Locked",
                    tint = MaterialTheme.colorScheme.primary
                )
            }
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = title,
                fontSize = 24.sp,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground
            )
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = subtitle,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
                color = if (hasError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val maxDots = if (enteredPin.length > 4) enteredPin.length else 4
                for (index in 0 until maxDots) {
                    val filled = index < enteredPin.length
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(
                                if (filled) MaterialTheme.colorScheme.primary else Color.Transparent
                            )
                            .border(
                                width = 1.5.dp,
                                color = if (filled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                shape = CircleShape
                            )
                    )
                }
            }
        }

        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            val rows = listOf(
                listOf("1", "2", "3"),
                listOf("4", "5", "6"),
                listOf("7", "8", "9")
            )
            rows.forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    row.forEach { digit ->
                        PinKeyButton(label = digit, enabled = lockoutRemaining == 0) {
                            submitDigit(digit)
                        }
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .clickable(enabled = enteredPin.isNotEmpty() && lockoutRemaining == 0) {
                            enteredPin = enteredPin.dropLast(1)
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Backspace,
                        contentDescription = "Backspace",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                PinKeyButton(label = "0", enabled = lockoutRemaining == 0) {
                    submitDigit("0")
                }

                Box(
                    modifier = Modifier
                        .size(72.dp)
                        .clip(CircleShape)
                        .background(
                            if (enteredPin.length >= 4 && lockoutRemaining == 0)
                                MaterialTheme.colorScheme.primary
                            else
                                MaterialTheme.colorScheme.surfaceVariant
                        )
                        .clickable(enabled = enteredPin.length >= 4 && lockoutRemaining == 0) {
                            submitAction()
                        },
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = "Confirm PIN",
                        tint = if (enteredPin.length >= 4)
                            MaterialTheme.colorScheme.onPrimary
                        else
                            MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (!isSetupMode && !recoveryQuestion.isNullOrBlank()) {
                TextButton(
                    onClick = { showRecoveryDialog = true },
                    enabled = lockoutRemaining == 0
                ) {
                    Text(
                        text = "Forgot PIN? Use Encrypted Recovery",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(12.dp))
            }
        }
    }

    if (showRecoveryDialog && !recoveryQuestion.isNullOrBlank()) {
        RecoveryResetDialog(
            question = recoveryQuestion,
            onDismiss = { showRecoveryDialog = false },
            onSubmit = { answer, newPin ->
                val (ok, msg) = onRecoverPin(answer, newPin)
                if (ok) {
                    showRecoveryDialog = false
                }
                ok to msg
            }
        )
    }
}

@Composable
private fun RecoveryResetDialog(
    question: String,
    onDismiss: () -> Unit,
    onSubmit: (answer: String, newPin: String) -> Pair<Boolean, String?>
) {
    var answer by remember { mutableStateOf("") }
    var newPin by remember { mutableStateOf("") }
    var confirmPin by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf<String?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Security & Recovery Reset") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    text = question,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                OutlinedTextField(
                    value = answer,
                    onValueChange = {
                        answer = it
                        errorText = null
                    },
                    label = { Text("Recovery Answer") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = newPin,
                    onValueChange = { input ->
                        newPin = input.filter { it.isDigit() }.take(8)
                        errorText = null
                    },
                    label = { Text("New PIN (4-8 digits)") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = confirmPin,
                    onValueChange = { input ->
                        confirmPin = input.filter { it.isDigit() }.take(8)
                        errorText = null
                    },
                    label = { Text("Confirm New PIN") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                if (errorText != null) {
                    Text(
                        text = errorText!!,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    when {
                        answer.trim().length < 3 -> errorText = "Enter your recovery answer."
                        newPin.length !in 4..8 -> errorText = "New PIN must be 4 to 8 digits."
                        newPin != confirmPin -> errorText = "New PINs do not match."
                        else -> {
                            val (ok, msg) = onSubmit(answer, newPin)
                            if (!ok) {
                                errorText = msg ?: "Recovery answer verification failed."
                            }
                        }
                    }
                }
            ) {
                Text("Reset PIN")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

@Composable
private fun PinKeyButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(72.dp)
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            fontSize = 24.sp,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface
        )
    }
}
