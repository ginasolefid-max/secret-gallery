package com.secretgallery.vault.media

import android.Manifest
import android.app.RecoverableSecurityException
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.IntentSender
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.LruCache
import android.util.Size
import androidx.core.content.ContextCompat
import com.secretgallery.vault.data.PhotoHandlingMode
import com.secretgallery.vault.data.VaultPhoto
import java.io.File
import java.util.UUID

sealed class PurgeResult {
    data object Deleted : PurgeResult()
    data class NeedsSystemConsent(val intentSender: IntentSender) : PurgeResult()
    data class Failed(val reason: String) : PurgeResult()
}

data class DeviceImage(
    val id: Long,
    val uri: Uri,
    val name: String,
    val dateAddedSec: Long
)

data class StagedImport(
    val photoId: String,
    val originalName: String,
    val mimeType: String,
    val rawBytes: ByteArray,
    val sourceUri: Uri,
    val stealthPath: String?
)

class GalleryMediaHandler(
    private val context: Context,
    private val encryptBytes: (ByteArray) -> ByteArray
) {

    private val thumbCache = LruCache<Long, Bitmap>(300)

    // ---------- Permissions ----------

    fun mediaPermissions(): Array<String> = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(
            Manifest.permission.READ_MEDIA_IMAGES,
            Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED
        )
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES)
        Build.VERSION.SDK_INT >= 29 -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        else -> arrayOf(
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE
        )
    }

    fun hasMediaPermission(): Boolean {
        fun granted(p: String) =
            ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED
        return when {
            Build.VERSION.SDK_INT >= 34 ->
                granted(Manifest.permission.READ_MEDIA_IMAGES) ||
                    granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            Build.VERSION.SDK_INT >= 33 -> granted(Manifest.permission.READ_MEDIA_IMAGES)
            Build.VERSION.SDK_INT >= 29 -> granted(Manifest.permission.READ_EXTERNAL_STORAGE)
            else -> granted(Manifest.permission.READ_EXTERNAL_STORAGE) &&
                granted(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    // Stealth copies now always live in the app's own external folder (encrypted),
    // so the risky "All files access" permission is no longer needed.
    fun hasAllFilesAccess(): Boolean = true

    // ---------- Device gallery listing (real MediaStore URIs) ----------

    private fun imagesCollection(): Uri =
        if (Build.VERSION.SDK_INT >= 29) {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        }

    fun queryDeviceImages(limit: Int = 5000): List<DeviceImage> {
        val collection = imagesCollection()
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_ADDED
        )
        val result = ArrayList<DeviceImage>()
        try {
            context.contentResolver.query(
                collection,
                projection,
                null,
                null,
                "${MediaStore.Images.Media.DATE_ADDED} DESC"
            )?.use { c ->
                val idCol = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val dateCol = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
                while (c.moveToNext() && result.size < limit) {
                    val id = c.getLong(idCol)
                    result.add(
                        DeviceImage(
                            id = id,
                            uri = ContentUris.withAppendedId(collection, id),
                            name = c.getString(nameCol) ?: "IMG_$id.jpg",
                            dateAddedSec = c.getLong(dateCol)
                        )
                    )
                }
            }
        } catch (_: Exception) {
        }
        return result
    }

    fun loadDeviceThumbnail(image: DeviceImage): Bitmap? {
        thumbCache.get(image.id)?.let { return it }
        val bmp = try {
            if (Build.VERSION.SDK_INT >= 29) {
                context.contentResolver.loadThumbnail(image.uri, Size(256, 256), null)
            } else {
                @Suppress("DEPRECATION")
                MediaStore.Images.Thumbnails.getThumbnail(
                    context.contentResolver,
                    image.id,
                    MediaStore.Images.Thumbnails.MINI_KIND,
                    null
                )
            }
        } catch (_: Exception) {
            null
        }
        if (bmp != null) thumbCache.put(image.id, bmp)
        return bmp
    }

    fun clearThumbCache() {
        thumbCache.evictAll()
    }

    // ---------- Import ----------

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
     * Permanently removes the original photos from Android's public MediaStore so they
     * disappear from the gallery. All URIs MUST be real MediaStore image URIs.
     */
    fun purgeOriginals(uris: List<Uri>): PurgeResult {
        if (uris.isEmpty()) return PurgeResult.Deleted
        val resolver = context.contentResolver

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return try {
                val pendingIntent = MediaStore.createDeleteRequest(resolver, uris)
                PurgeResult.NeedsSystemConsent(pendingIntent.intentSender)
            } catch (e: Exception) {
                PurgeResult.Failed(e.message ?: "Could not request deletion.")
            }
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
            )?.use { cursor -> cursor.moveToFirst() } ?: false
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
        // Encrypted, so the hidden copy is never a readable photo.
        hiddenFile.writeBytes(encryptBytes(bytes))

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
            try {
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
            } catch (_: Exception) {
                false
            }
        }
    }

    private fun getStealthVaultDir(): File? {
        val appExternal = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES) ?: return null
        return File(appExternal, ".SecretGalleryVault")
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
