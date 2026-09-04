package com.porizo.core.platform

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.porizo.core.domain.platform.NativeRecording
import com.porizo.core.domain.platform.PlatformResult
import com.porizo.core.domain.platform.VoiceRecorder
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.concurrent.thread
import kotlin.math.max

@Singleton
class RecorderProvider @Inject constructor(
    @param:ApplicationContext private val context: Context,
    private val activityHolder: ActivityHolder,
) : VoiceRecorder {
    private var recorder: AudioRecord? = null
    private var recordingThread: Thread? = null
    @Volatile private var isRecording = false
    private var activeFile: File? = null
    private var bytesWritten: Long = 0L
    private var startedAtMs: Long = 0L
    private var lastStatus: String = "Recorder idle."

    override fun hasMicrophonePermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    override fun requestMicrophonePermission(): String {
        val activity = activityHolder.current() ?: return "Open the app foreground before requesting microphone permission."
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            return "Microphone permission already granted."
        }
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE_REQUEST_CODE)
        return "Microphone permission requested."
    }

    override fun startRecording(): PlatformResult<String> {
        if (isRecording) return PlatformResult.Failure("Recording is already in progress.")
        if (!hasMicrophonePermission()) return PlatformResult.Failure("Microphone permission is required.")

        val minBuffer = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
        )
        if (minBuffer <= 0) return PlatformResult.Failure("Android microphone buffer is unavailable.")

        val bufferSize = max(minBuffer, SAMPLE_RATE * 2)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize,
        )
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            return PlatformResult.Failure("Android AudioRecord did not initialize.")
        }

        val file = File(context.cacheDir, "porizo-enrollment-${System.currentTimeMillis()}.wav")
        val randomAccessFile = RandomAccessFile(file, "rw")
        randomAccessFile.setLength(0)
        randomAccessFile.write(ByteArray(WAV_HEADER_BYTES))

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
                            randomAccessFile.write(buffer, 0, read)
                            bytesWritten += read.toLong()
                        }
                    }
                }
            } finally {
                runCatching { randomAccessFile.close() }
            }
        }

        lastStatus = "Recording started."
        return PlatformResult.Success(file.absolutePath)
    }

    override fun stopRecording(): PlatformResult<NativeRecording> {
        if (!isRecording) return PlatformResult.Failure("No recording is in progress.")
        isRecording = false
        val localRecorder = recorder
        runCatching { localRecorder?.stop() }
        runCatching { recordingThread?.join(1_500) }
        localRecorder?.release()
        recorder = null
        recordingThread = null

        val file = activeFile ?: return PlatformResult.Failure("Recording file is missing.")
        val durationSec = if (bytesWritten > 0) {
            bytesWritten.toDouble() / (SAMPLE_RATE.toDouble() * CHANNEL_COUNT.toDouble() * (BITS_PER_SAMPLE.toDouble() / 8.0))
        } else {
            (System.currentTimeMillis() - startedAtMs).toDouble() / 1_000.0
        }
        writeWavHeader(file, bytesWritten)
        val checksum = sha256(file)
        lastStatus = "Recording stopped."
        return PlatformResult.Success(
            NativeRecording(
                path = file.absolutePath,
                durationSec = durationSec,
                bytes = file.length(),
                checksum = checksum,
            ),
        )
    }

    override fun readBytes(recording: NativeRecording): ByteArray? =
        File(recording.path).takeIf { it.isFile }?.readBytes()

    override fun delete(recording: NativeRecording): String {
        val file = File(recording.path)
        return if (file.delete()) "Recording deleted." else "Recording was already removed or could not be deleted."
    }

    override fun status(): String = lastStatus

    private fun writeWavHeader(file: File, dataBytes: Long) {
        RandomAccessFile(file, "rw").use { raf ->
            raf.seek(0)
            raf.writeBytes("RIFF")
            raf.writeIntLe((36 + dataBytes).toInt())
            raf.writeBytes("WAVE")
            raf.writeBytes("fmt ")
            raf.writeIntLe(16)
            raf.writeShortLe(1)
            raf.writeShortLe(CHANNEL_COUNT)
            raf.writeIntLe(SAMPLE_RATE)
            raf.writeIntLe(SAMPLE_RATE * CHANNEL_COUNT * BITS_PER_SAMPLE / 8)
            raf.writeShortLe(CHANNEL_COUNT * BITS_PER_SAMPLE / 8)
            raf.writeShortLe(BITS_PER_SAMPLE)
            raf.writeBytes("data")
            raf.writeIntLe(dataBytes.toInt())
        }
    }

    private fun RandomAccessFile.writeIntLe(value: Int) {
        write(value and 0xff)
        write((value shr 8) and 0xff)
        write((value shr 16) and 0xff)
        write((value shr 24) and 0xff)
    }

    private fun RandomAccessFile.writeShortLe(value: Int) {
        write(value and 0xff)
        write((value shr 8) and 0xff)
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

    private companion object {
        const val SAMPLE_RATE = 44_100
        const val CHANNEL_COUNT = 1
        const val BITS_PER_SAMPLE = 16
        const val WAV_HEADER_BYTES = 44
        const val MICROPHONE_REQUEST_CODE = 3102
    }
}
