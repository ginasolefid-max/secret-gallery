package com.secretgallery.vault.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AddPhotoAlternate
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.secretgallery.vault.data.PhotoHandlingMode
import com.secretgallery.vault.data.VaultPhoto
import com.secretgallery.vault.data.VaultRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val PRESET_RECOVERY_QUESTIONS = listOf(
    "What was the name of your first school?",
    "In what city did your parents meet?",
    "What was the name of your childhood pet?"
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultScreen(
    photos: List<VaultPhoto>,
    selectedMode: PhotoHandlingMode,
    hasAllFilesAccess: Boolean,
    hasRecoveryConfigured: Boolean,
    currentRecoveryQuestion: String?,
    statusMessage: String?,
    repository: VaultRepository,
    onModeChange: (PhotoHandlingMode) -> Unit,
    onImportClick: () -> Unit,
    onRequestAllFilesAccess: () -> Unit,
    onConfigureRecovery: (currentPin: String, question: String, answer: String) -> Pair<Boolean, String>,
    onClearRecovery: (currentPin: String) -> Pair<Boolean, String>,
    onChangePin: (currentPin: String, newPin: String) -> Pair<Boolean, String>,
    onRestorePhoto: (VaultPhoto) -> Unit,
    onDeletePhoto: (VaultPhoto) -> Unit,
    onLockNow: () -> Unit,
    onDismissStatus: () -> Unit
) {
    var inspectedPhoto by remember { mutableStateOf<VaultPhoto?>(null) }
    var showSettings by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                title = {
                    Column {
                        Text(
                            text = "Secret Gallery",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = "${photos.size} encrypted · ${selectedMode.label}",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Default.Settings, contentDescription = "Vault Settings")
                    }
                    IconButton(onClick = onLockNow) {
                        Icon(Icons.Default.Lock, contentDescription = "Lock Vault")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onImportClick,
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary
            ) {
                Icon(Icons.Default.AddPhotoAlternate, contentDescription = "Hide Photos")
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (statusMessage != null) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = statusMessage,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.weight(1f)
                    )
                    TextButton(onClick = onDismissStatus) {
                        Text("Dismiss")
                    }
                }
            }

            if (photos.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(32.dp)
                    ) {
                        Text(
                            text = "Your vault is empty",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onBackground
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Tap + to import photos. Originals are purged from public MediaStore and stored encrypted with AES-256-GCM.",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.height(20.dp))
                        Button(onClick = onImportClick) {
                            Text("Import Photos")
                        }
                    }
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(photos, key = { it.id }) { photo ->
                        VaultThumbnailTile(
                            photo = photo,
                            repository = repository,
                            onClick = { inspectedPhoto = photo }
                        )
                    }
                }
            }
        }
    }

    inspectedPhoto?.let { activePhoto ->
        SecurePhotoViewerDialog(
            photo = activePhoto,
            repository = repository,
            onClose = { inspectedPhoto = null },
            onRestore = {
                onRestorePhoto(activePhoto)
                inspectedPhoto = null
            },
            onDelete = {
                onDeletePhoto(activePhoto)
                inspectedPhoto = null
            }
        )
    }

    if (showSettings) {
        VaultSettingsDialog(
            selectedMode = selectedMode,
            hasAllFilesAccess = hasAllFilesAccess,
            hasRecoveryConfigured = hasRecoveryConfigured,
            currentRecoveryQuestion = currentRecoveryQuestion,
            onModeChange = onModeChange,
            onRequestAllFilesAccess = onRequestAllFilesAccess,
            onConfigureRecovery = onConfigureRecovery,
            onClearRecovery = onClearRecovery,
            onChangePin = onChangePin,
            onDismiss = { showSettings = false }
        )
    }
}

@Composable
private fun VaultSettingsDialog(
    selectedMode: PhotoHandlingMode,
    hasAllFilesAccess: Boolean,
    hasRecoveryConfigured: Boolean,
    currentRecoveryQuestion: String?,
    onModeChange: (PhotoHandlingMode) -> Unit,
    onRequestAllFilesAccess: () -> Unit,
    onConfigureRecovery: (currentPin: String, question: String, answer: String) -> Pair<Boolean, String>,
    onClearRecovery: (currentPin: String) -> Pair<Boolean, String>,
    onChangePin: (currentPin: String, newPin: String) -> Pair<Boolean, String>,
    onDismiss: () -> Unit
) {
    var activeTab by remember { mutableIntStateOf(0) }

    var recoveryQuestion by remember(currentRecoveryQuestion) {
        mutableStateOf(currentRecoveryQuestion ?: PRESET_RECOVERY_QUESTIONS.first())
    }
    var recoveryAnswer by remember { mutableStateOf("") }
    var recoveryPinConfirm by remember { mutableStateOf("") }
    var recoveryFeedback by remember { mutableStateOf<Pair<Boolean, String>?>(null) }

    var pinCurrent by remember { mutableStateOf("") }
    var pinNew by remember { mutableStateOf("") }
    var pinFeedback by remember { mutableStateOf<Pair<Boolean, String>?>(null) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Vault Settings") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                TabRow(selectedTabIndex = activeTab) {
                    Tab(
                        selected = activeTab == 0,
                        onClick = { activeTab = 0 },
                        text = { Text("Photo Handling", fontSize = 12.sp, maxLines = 1) }
                    )
                    Tab(
                        selected = activeTab == 1,
                        onClick = { activeTab = 1 },
                        text = { Text("Security & Recovery", fontSize = 12.sp, maxLines = 1) }
                    )
                }

                if (activeTab == 0) {
                    PhotoHandlingMode.entries.forEach { mode ->
                        val active = mode == selectedMode
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    if (active) MaterialTheme.colorScheme.surfaceVariant
                                    else MaterialTheme.colorScheme.surface
                                )
                                .border(
                                    1.dp,
                                    if (active) MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.surfaceVariant,
                                    RoundedCornerShape(10.dp)
                                )
                                .clickable { onModeChange(mode) }
                                .padding(12.dp)
                        ) {
                            Text(
                                text = mode.label,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Text(
                                text = mode.description,
                                fontSize = 12.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }

                    if (!hasAllFilesAccess) {
                        OutlinedButton(
                            onClick = onRequestAllFilesAccess,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Enable All-Files Access for .nomedia")
                        }
                    }
                } else {
                    Text(
                        text = "Secondary Recovery Question",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = if (hasRecoveryConfigured) {
                            "Encrypted recovery active (PBKDF2-SHA256 + AES-256-GCM DEK wrap)."
                        } else {
                            "Not configured. Set a recovery question so you can reset a forgotten PIN without losing encrypted photos."
                        },
                        fontSize = 12.sp,
                        color = if (hasRecoveryConfigured) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    PRESET_RECOVERY_QUESTIONS.forEach { preset ->
                        val selected = recoveryQuestion == preset
                        Text(
                            text = preset,
                            fontSize = 11.sp,
                            color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(MaterialTheme.colorScheme.surface)
                                .border(
                                    1.dp,
                                    if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                                    RoundedCornerShape(8.dp)
                                )
                                .clickable { recoveryQuestion = preset }
                                .padding(horizontal = 10.dp, vertical = 8.dp)
                        )
                    }

                    OutlinedTextField(
                        value = recoveryQuestion,
                        onValueChange = { recoveryQuestion = it },
                        label = { Text("Recovery Question") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = recoveryAnswer,
                        onValueChange = { recoveryAnswer = it },
                        label = { Text("Recovery Answer (encrypted)") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = recoveryPinConfirm,
                        onValueChange = { input ->
                            recoveryPinConfirm = input.filter { it.isDigit() }.take(8)
                        },
                        label = { Text("Confirm Current PIN") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    recoveryFeedback?.let { (ok, message) ->
                        Text(
                            text = message,
                            fontSize = 12.sp,
                            color = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                        )
                    }

                    Button(
                        onClick = {
                            val res = onConfigureRecovery(recoveryPinConfirm, recoveryQuestion, recoveryAnswer)
                            recoveryFeedback = res
                            if (res.first) {
                                recoveryAnswer = ""
                                recoveryPinConfirm = ""
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(if (hasRecoveryConfigured) "Update Encrypted Recovery" else "Save Encrypted Recovery")
                    }

                    if (hasRecoveryConfigured) {
                        OutlinedButton(
                            onClick = {
                                val res = onClearRecovery(recoveryPinConfirm)
                                recoveryFeedback = res
                                if (res.first) {
                                    recoveryPinConfirm = ""
                                }
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Remove Recovery Question")
                        }
                    }

                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

                    Text(
                        text = "Change Vault PIN",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    OutlinedTextField(
                        value = pinCurrent,
                        onValueChange = { input -> pinCurrent = input.filter { it.isDigit() }.take(8) },
                        label = { Text("Current PIN") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = pinNew,
                        onValueChange = { input -> pinNew = input.filter { it.isDigit() }.take(8) },
                        label = { Text("New PIN (4-8 digits)") },
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    pinFeedback?.let { (ok, message) ->
                        Text(
                            text = message,
                            fontSize = 12.sp,
                            color = if (ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
                        )
                    }
                    OutlinedButton(
                        onClick = {
                            val res = onChangePin(pinCurrent, pinNew)
                            pinFeedback = res
                            if (res.first) {
                                pinCurrent = ""
                                pinNew = ""
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Update PIN")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Done")
            }
        }
    )
}

@Composable
private fun VaultThumbnailTile(
    photo: VaultPhoto,
    repository: VaultRepository,
    onClick: () -> Unit
) {
    val thumbBitmap by produceState<android.graphics.Bitmap?>(initialValue = null, photo.id) {
        value = withContext(Dispatchers.IO) {
            repository.getThumbnailBitmap(photo.id)
        }
    }

    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick)
    ) {
        val bmp = thumbBitmap
        if (bmp != null && !bmp.isRecycled) {
            Image(
                bitmap = bmp.asImageBitmap(),
                contentDescription = photo.originalName,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
    }
}

@Composable
private fun SecurePhotoViewerDialog(
    photo: VaultPhoto,
    repository: VaultRepository,
    onClose: () -> Unit,
    onRestore: () -> Unit,
    onDelete: () -> Unit
) {
    val fullBitmap by produceState<android.graphics.Bitmap?>(initialValue = null, photo.id) {
        value = withContext(Dispatchers.IO) {
            val bytes = repository.decryptFullImageBytes(photo.id) ?: return@withContext null
            val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            bytes.fill(0)
            bmp
        }
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = photo.originalName,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onBackground,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${photo.handlingMode.label} · ${if (photo.publicPurgeVerified) "Public copy purged" else "Encrypted in vault"}",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                IconButton(onClick = onClose) {
                    Icon(Icons.Default.Close, contentDescription = "Close")
                }
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                val bmp = fullBitmap
                if (bmp != null && !bmp.isRecycled) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = photo.originalName,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Text("Decrypting in memory...", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedButton(
                    onClick = onRestore,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Restore, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.size(6.dp))
                    Text("Restore to Gallery")
                }
                Button(
                    onClick = onDelete,
                    modifier = Modifier.weight(1f)
                ) {
                    Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.size(6.dp))
                    Text("Delete")
                }
            }
        }
    }
}
