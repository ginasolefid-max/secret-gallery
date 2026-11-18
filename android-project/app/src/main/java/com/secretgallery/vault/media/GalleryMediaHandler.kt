package com.secretgallery.vault.media

import android.app.RecoverableSecurityException
import android.content.ContentValues
import android.content.Context
import android.content.IntentSender
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import com.secretgallery.vault.data.PhotoHandlingMode
import com.secretgallery.vault.data.VaultPhoto
import java.io.File
import java.util.UUID

sealed class PurgeResult {
    data object Deleted : PurgeResult()
    data class NeedsSystemConsent(val intentSender: IntentSender) : PurgeResult()
    data class Failed(val reason: String) : PurgeResult()
}

data class StagedImport(
    val photoId: String,
    val originalName: String,
    val mimeType: String,
    val rawBytes: ByteArray,
    val sourceUri: Uri,
    val stealthPath: String?
)

class GalleryMediaHandler(private val context: Context) {

    fun hasAllFilesAccess(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            true
        }
    }

    fun readImportPayload(uri: Uri, mode: PhotoHandlingMode): StagedImport {
        val resolver = context.contentResolver
        val mimeType = resolver.getType(uri) ?: "image/jpeg"
        val displayName = queryDisplayName(uri) ?: "IMG_${System.currentTimeMillis()}.jpg"
        val rawBytes = resolver.openInputStream(uri)?.use { it.readBytes() }
            ?: error("Unable to open selected image stream.")

        val photoId = UUID.randomUUID().toString()
        var stealthPath: String? = null

        if (mode == PhotoHandlingMode.STEALTH_NOMEDIA || mode == PhotoHandlingMode.BOTH_ENCRYPT_AND_STEALTH) {
            stealthPath = writeStealthNomediaCopy(photoId, displayName, rawBytes)
        }

        return StagedImport(
            photoId = photoId,
            originalName = displayName,
            mimeType = mimeType,
            rawBytes = rawBytes,
            sourceUri = uri,
            stealthPath = stealthPath
        )
    }

    /**
     * Permanently removes the original photo from Android's public MediaStore
     * so it disappears from Google Photos, stock Gallery, and file pickers.
     */
    fun purgeOriginalFromPublicGallery(uris: List<Uri>): PurgeResult {
        if (uris.isEmpty()) return PurgeResult.Deleted
        val resolver = context.contentResolver

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val existing = uris.filter { isMediaStoreUriAlive(it) }
            if (existing.isEmpty()) return PurgeResult.Deleted
            val pendingIntent = MediaStore.createDeleteRequest(resolver, existing)
            return PurgeResult.NeedsSystemConsent(pendingIntent.intentSender)
        }

        return try {
            for (uri in uris) {
                resolver.delete(uri, null, null)
            }
            PurgeResult.Deleted
        } catch (sec: SecurityException) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && sec is RecoverableSecurityException) {
                PurgeResult.NeedsSystemConsent(sec.userAction.actionIntent.intentSender)
            } else {
                PurgeResult.Failed(sec.message ?: "Permission denied deleting public original.")
            }
        }
    }

    fun isMediaStoreUriAlive(uri: Uri): Boolean {
        return try {
            context.contentResolver.query(
                uri,
                arrayOf(MediaStore.MediaColumns._ID),
                null,
                null,
                null
            )?.use { cursor ->
                cursor.moveToFirst()
            } ?: false
        } catch (_: Exception) {
            false
        }
    }

    private fun writeStealthNomediaCopy(photoId: String, originalName: String, bytes: ByteArray): String? {
        val stealthDir = getStealthVaultDir() ?: return null
        if (!stealthDir.exists() && !stealthDir.mkdirs()) return null

        val nomedia = File(stealthDir, ".nomedia")
        if (!nomedia.exists()) {
            nomedia.createNewFile()
        }

        val safeName = originalName.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val hiddenFile = File(stealthDir, ".${photoId}_$safeName.sv")
        hiddenFile.writeBytes(bytes)

        // Prompt MediaScanner on the directory so Android removes any indexed children under .nomedia
        MediaScannerConnection.scanFile(
            context,
            arrayOf(nomedia.absolutePath, stealthDir.absolutePath),
            null,
            null
        )
        return hiddenFile.absolutePath
    }

    fun deleteStealthCopyIfPresent(stealthPath: String?) {
        if (stealthPath.isNullOrBlank()) return
        runCatching {
            val file = File(stealthPath)
            if (file.exists()) {
                file.delete()
            }
        }
    }

    fun restoreToPublicGallery(photo: VaultPhoto, decryptedBytes: ByteArray): Boolean {
        val resolver = context.contentResolver
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, photo.originalName)
                put(MediaStore.Images.Media.MIME_TYPE, photo.mimeType)
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Restored")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val targetUri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: return false
            try {
                resolver.openOutputStream(targetUri)?.use { out ->
                    out.write(decryptedBytes)
                } ?: return false
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(targetUri, values, null, null)
                true
            } catch (_: Exception) {
                resolver.delete(targetUri, null, null)
                false
            }
        } else {
            @Suppress("DEPRECATION")
            val dir = File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                "Restored"
            )
            if (!dir.exists()) dir.mkdirs()
            val outFile = File(dir, photo.originalName)
            outFile.writeBytes(decryptedBytes)
            MediaScannerConnection.scanFile(context, arrayOf(outFile.absolutePath), arrayOf(photo.mimeType), null)
            true
        }
    }

    private fun getStealthVaultDir(): File? {
        if (!hasAllFilesAccess()) {
            // Fall back to app-private external media folder with .nomedia when MANAGE_EXTERNAL_STORAGE is off
            val appExternal = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: return null
            return File(appExternal, ".SecretGalleryVault")
        }
        @Suppress("DEPRECATION")
        val sharedPictures = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
        return File(sharedPictures, ".SecretGalleryVault")
    }

    private fun queryDisplayName(uri: Uri): String? {
        return context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null
        )?.use { cursor ->
            if (cursor.moveToFirst()) {
                val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (idx >= 0) cursor.getString(idx) else null
            } else {
                null
            }
        }
    }
}
