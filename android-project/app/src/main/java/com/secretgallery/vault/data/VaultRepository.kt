package com.secretgallery.vault.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.secretgallery.vault.crypto.VaultCrypto
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.ConcurrentHashMap

enum class PhotoHandlingMode(val label: String, val description: String) {
    MOVE_AND_ENCRYPT(
        label = "Move & Encrypt",
        description = "Encrypts into private app sandbox and deletes original from public gallery"
    ),
    STEALTH_NOMEDIA(
        label = "Stealth .nomedia",
        description = "Moves to hidden .nomedia folder, de-indexes from MediaStore, and encrypts backup"
    ),
    BOTH_ENCRYPT_AND_STEALTH(
        label = "Both (Dual Lock)",
        description = "Stores AES-256-GCM encrypted vault file + .nomedia hidden directory + purges public MediaStore"
    )
}

data class VaultPhoto(
    val id: String,
    val originalName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val width: Int,
    val height: Int,
    val handlingMode: PhotoHandlingMode,
    val importedAtMs: Long,
    val publicPurgeVerified: Boolean,
    val stealthPath: String? = null
)

class VaultRepository(
    context: Context,
    private val crypto: VaultCrypto
) {
    private val vaultDir = File(context.filesDir, "vault").apply { mkdirs() }
    private val mediaDir = File(vaultDir, "media").apply { mkdirs() }
    private val thumbDir = File(vaultDir, "thumbs").apply { mkdirs() }
    private val indexFile = File(vaultDir, "index.enc")

    private val thumbRamCache = ConcurrentHashMap<String, Bitmap>()

    fun loadPhotos(): List<VaultPhoto> {
        if (!crypto.isUnlocked()) return emptyList()
        if (!indexFile.exists()) return emptyList()
        val encrypted = indexFile.readBytes()
        val jsonText = crypto.decryptBytes(encrypted).toString(Charsets.UTF_8)
        val array = JSONArray(jsonText)
        val items = ArrayList<VaultPhoto>(array.length())
        for (i in 0 until array.length()) {
            val obj = array.getJSONObject(i)
            items.add(
                VaultPhoto(
                    id = obj.getString("id"),
                    originalName = obj.getString("originalName"),
                    mimeType = obj.getString("mimeType"),
                    sizeBytes = obj.getLong("sizeBytes"),
                    width = obj.optInt("width", 0),
                    height = obj.optInt("height", 0),
                    handlingMode = runCatching {
                        PhotoHandlingMode.valueOf(obj.getString("handlingMode"))
                    }.getOrDefault(PhotoHandlingMode.BOTH_ENCRYPT_AND_STEALTH),
                    importedAtMs = obj.getLong("importedAtMs"),
                    publicPurgeVerified = obj.optBoolean("publicPurgeVerified", false),
                    stealthPath = obj.optString("stealthPath").takeIf { it.isNotBlank() }
                )
            )
        }
        return items.sortedByDescending { it.importedAtMs }
    }

    fun savePhoto(
        id: String,
        originalName: String,
        mimeType: String,
        rawBytes: ByteArray,
        handlingMode: PhotoHandlingMode,
        publicPurgeVerified: Boolean,
        stealthPath: String?
    ): VaultPhoto {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size, bounds)

        val encryptedMedia = crypto.encryptBytes(rawBytes)
        File(mediaDir, "$id.enc").writeBytes(encryptedMedia)

        val thumbBytes = createThumbnailBytes(rawBytes)
        val encryptedThumb = crypto.encryptBytes(thumbBytes)
        File(thumbDir, "$id.thumb.enc").writeBytes(encryptedThumb)

        val entry = VaultPhoto(
            id = id,
            originalName = originalName,
            mimeType = mimeType,
            sizeBytes = rawBytes.size.toLong(),
            width = bounds.outWidth.coerceAtLeast(0),
            height = bounds.outHeight.coerceAtLeast(0),
            handlingMode = handlingMode,
            importedAtMs = System.currentTimeMillis(),
            publicPurgeVerified = publicPurgeVerified,
            stealthPath = stealthPath
        )

        val current = loadPhotos().toMutableList()
        current.add(0, entry)
        persistIndex(current)
        return entry
    }

    fun markPublicPurged(photoIds: Set<String>) {
        if (photoIds.isEmpty()) return
        val updated = loadPhotos().map { item ->
            if (item.id in photoIds) item.copy(publicPurgeVerified = true) else item
        }
        persistIndex(updated)
    }

    fun getThumbnailBitmap(photoId: String): Bitmap? {
        if (!crypto.isUnlocked()) return null
        thumbRamCache[photoId]?.let { if (!it.isRecycled) return it }
        val file = File(thumbDir, "$photoId.thumb.enc")
        if (!file.exists()) return null
        val decrypted = crypto.decryptBytes(file.readBytes())
        val bitmap = BitmapFactory.decodeByteArray(decrypted, 0, decrypted.size)
        decrypted.fill(0)
        if (bitmap != null) {
            thumbRamCache[photoId] = bitmap
        }
        return bitmap
    }

    fun decryptFullImageBytes(photoId: String): ByteArray? {
        if (!crypto.isUnlocked()) return null
        val file = File(mediaDir, "$photoId.enc")
        if (!file.exists()) return null
        return crypto.decryptBytes(file.readBytes())
    }

    fun deletePhoto(photoId: String): VaultPhoto? {
        val all = loadPhotos()
        val target = all.find { it.id == photoId } ?: return null
        File(mediaDir, "$photoId.enc").delete()
        File(thumbDir, "$photoId.thumb.enc").delete()
        thumbRamCache.remove(photoId)
        persistIndex(all.filterNot { it.id == photoId })
        return target
    }

    fun clearRamCaches() {
        thumbRamCache.clear()
    }

    private fun persistIndex(items: List<VaultPhoto>) {
        val array = JSONArray()
        for (item in items) {
            array.put(
                JSONObject().apply {
                    put("id", item.id)
                    put("originalName", item.originalName)
                    put("mimeType", item.mimeType)
                    put("sizeBytes", item.sizeBytes)
                    put("width", item.width)
                    put("height", item.height)
                    put("handlingMode", item.handlingMode.name)
                    put("importedAtMs", item.importedAtMs)
                    put("publicPurgeVerified", item.publicPurgeVerified)
                    put("stealthPath", item.stealthPath ?: "")
                }
            )
        }
        val encrypted = crypto.encryptBytes(array.toString().toByteArray(Charsets.UTF_8))
        indexFile.writeBytes(encrypted)
    }

    private fun createThumbnailBytes(rawBytes: ByteArray): ByteArray {
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size, opts)
        var sample = 1
        while (opts.outWidth / sample > 420 || opts.outHeight / sample > 420) {
            sample *= 2
        }
        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bmp = BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size, decodeOpts)
            ?: return rawBytes
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 82, out)
        bmp.recycle()
        return out.toByteArray()
    }
}
