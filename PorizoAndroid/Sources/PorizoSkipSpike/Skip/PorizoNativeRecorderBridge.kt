package porizo.skip.spike

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import android.util.Base64
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import kotlin.concurrent.thread
import kotlin.math.max

object PorizoNativeRecorderBridge {
    private const val sampleRate = 44100
    private const val channelCount = 1
    private const val bitsPerSample = 16
    private const val microphoneRequestCode = 3102
    private var currentActivity: Activity? = null
    private var recorder: AudioRecord? = null
    private var recordingThread: Thread? = null
    @Volatile private var isRecording = false
    private var activeFile: File? = null
    private var bytesWritten: Long = 0L
    private var startedAtMs: Long = 0L
    private var lastStatus: String = "Recorder idle."

    fun setActivity(activity: Activity?) {
        currentActivity = activity
    }

    fun hasMicrophonePermission(context: Context): Boolean {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    }

    fun requestMicrophonePermission(): String {
        val activity = currentActivity ?: return "Open the app foreground before requesting microphone permission."
        if (hasMicrophonePermission(activity)) {
            return "Microphone permission already granted."
        }
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), microphoneRequestCode)
        return "Microphone permission requested."
    }

    fun startRecording(context: Context): String {
        if (isRecording) {
            return "ERROR|Recording is already in progress."
        }
        if (!hasMicrophonePermission(context)) {
            return "ERROR|Microphone permission is required."
        }

        val minBuffer = AudioRecord.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuffer <= 0) {
            return "ERROR|Android microphone buffer is unavailable."
        }

        val bufferSize = max(minBuffer, sampleRate * 2)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            return "ERROR|Android AudioRecord did not initialize."
        }

        val file = File(context.cacheDir, "porizo-enrollment-${System.currentTimeMillis()}.wav")
        val raf = RandomAccessFile(file, "rw")
        raf.setLength(0)
        raf.write(ByteArray(44))

        recorder = audioRecord
        activeFile = file
        bytesWritten = 0L
        startedAtMs = System.currentTimeMillis()
        isRecording = true
        audioRecord.startRecording()

        recordingThread = thread(name = "porizo-voice-recorder") {
            val buffer = ByteArray(bufferSize)
            try {
                while (isRecording) {
                    val read = audioRecord.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        synchronized(this) {
                            raf.write(buffer, 0, read)
                            bytesWritten += read.toLong()
                        }
                    }
                }
            } finally {
                try {
                    raf.close()
                } catch (_: Exception) {
                }
            }
        }

        lastStatus = "Recording started."
        return "OK|${file.absolutePath}"
    }

    fun stopRecording(): String {
        if (!isRecording) {
            return "ERROR|No recording is in progress."
        }
        isRecording = false
        val localRecorder = recorder
        try {
            localRecorder?.stop()
        } catch (_: Exception) {
        }
        try {
            recordingThread?.join(1500)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
        localRecorder?.release()
        recorder = null
        recordingThread = null

        val file = activeFile ?: return "ERROR|Recording file is missing."
        val durationSec = if (bytesWritten > 0) {
            bytesWritten.toDouble() / (sampleRate.toDouble() * channelCount.toDouble() * (bitsPerSample.toDouble() / 8.0))
        } else {
            (System.currentTimeMillis() - startedAtMs).toDouble() / 1000.0
        }
        writeWavHeader(file, bytesWritten)
        val checksum = sha256(file)
        lastStatus = "Recording stopped."
        return "OK|${file.absolutePath}|${"%.3f".format(durationSec)}|${file.length()}|$checksum"
    }

    fun readRecordingBase64(path: String): String? {
        val file = File(path)
        if (!file.isFile) {
            return null
        }
        return Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)
    }

    fun deleteRecording(path: String): String {
        val file = File(path)
        return if (file.delete()) "Recording deleted." else "Recording was already removed or could not be deleted."
    }

    fun status(): String {
        return lastStatus
    }

    private fun writeWavHeader(file: File, dataBytes: Long) {
        RandomAccessFile(file, "rw").use { raf ->
            raf.seek(0)
            raf.writeBytes("RIFF")
            writeIntLE(raf, (36 + dataBytes).toInt())
            raf.writeBytes("WAVE")
            raf.writeBytes("fmt ")
            writeIntLE(raf, 16)
            writeShortLE(raf, 1)
            writeShortLE(raf, channelCount)
            writeIntLE(raf, sampleRate)
            writeIntLE(raf, sampleRate * channelCount * bitsPerSample / 8)
            writeShortLE(raf, channelCount * bitsPerSample / 8)
            writeShortLE(raf, bitsPerSample)
            raf.writeBytes("data")
            writeIntLE(raf, dataBytes.toInt())
        }
    }

    private fun writeIntLE(raf: RandomAccessFile, value: Int) {
        raf.write(value and 0xff)
        raf.write((value shr 8) and 0xff)
        raf.write((value shr 16) and 0xff)
        raf.write((value shr 24) and 0xff)
    }

    private fun writeShortLE(raf: RandomAccessFile, value: Int) {
        raf.write(value and 0xff)
        raf.write((value shr 8) and 0xff)
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
