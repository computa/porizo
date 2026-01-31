//
//  WAVWriter.swift
//  PorizoApp
//
//  Writes clean 44-byte WAV files without iOS's JUNK/FLLR padding chunks.
//  iOS's AVAudioRecorder adds non-standard chunks that push audio data to
//  offset 4096. This utility exports clean WAV files with standard structure.
//

import Foundation
import AVFoundation

/// Writes clean 44-byte WAV files without iOS's JUNK/FLLR padding chunks
struct WAVWriter {

    enum Error: LocalizedError {
        case emptyData
        case fileTooShort(minSamples: Int, actualSamples: Int)
        case readError(underlying: Swift.Error)
        case writeError(underlying: Swift.Error)

        var errorDescription: String? {
            switch self {
            case .emptyData:
                return "Cannot write WAV file with empty audio data"
            case .fileTooShort(let min, let actual):
                return "Recording too short: \(actual) samples, need at least \(min)"
            case .readError(let error):
                return "Failed to read audio file: \(error.localizedDescription)"
            case .writeError(let error):
                return "Failed to write WAV file: \(error.localizedDescription)"
            }
        }
    }

    /// Standard recording format for voice enrollment
    static let standardFormat = Format(sampleRate: 44100, channels: 1, bitsPerSample: 16)

    /// Minimum samples for valid recording (~0.5 seconds at 44.1kHz)
    static let minSamples: Int = 22050

    struct Format {
        let sampleRate: UInt32
        let channels: UInt16
        let bitsPerSample: UInt16

        var byteRate: UInt32 {
            sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        }

        var blockAlign: UInt16 {
            channels * (bitsPerSample / 8)
        }
    }

    // MARK: - Public API

    /// Builds a standard 44-byte WAV header
    static func buildHeader(sampleRate: UInt32, channels: UInt16, bitsPerSample: UInt16, dataSize: UInt32) -> Data {
        let format = Format(sampleRate: sampleRate, channels: channels, bitsPerSample: bitsPerSample)
        return buildHeader(format: format, dataSize: dataSize)
    }

    /// Builds a standard 44-byte WAV header from Format
    static func buildHeader(format: Format, dataSize: UInt32) -> Data {
        var header = Data(capacity: 44)

        // RIFF header (12 bytes)
        header.append(contentsOf: "RIFF".utf8)                              // 0-3: ChunkID
        header.append(littleEndian: UInt32(36 + dataSize))                  // 4-7: ChunkSize
        header.append(contentsOf: "WAVE".utf8)                              // 8-11: Format

        // fmt subchunk (24 bytes)
        header.append(contentsOf: "fmt ".utf8)                              // 12-15: Subchunk1ID
        header.append(littleEndian: UInt32(16))                             // 16-19: Subchunk1Size (16 for PCM)
        header.append(littleEndian: UInt16(1))                              // 20-21: AudioFormat (1 = PCM)
        header.append(littleEndian: format.channels)                        // 22-23: NumChannels
        header.append(littleEndian: format.sampleRate)                      // 24-27: SampleRate
        header.append(littleEndian: format.byteRate)                        // 28-31: ByteRate
        header.append(littleEndian: format.blockAlign)                      // 32-33: BlockAlign
        header.append(littleEndian: format.bitsPerSample)                   // 34-35: BitsPerSample

        // data subchunk header (8 bytes)
        header.append(contentsOf: "data".utf8)                              // 36-39: Subchunk2ID
        header.append(littleEndian: dataSize)                               // 40-43: Subchunk2Size

        return header
    }

    /// Writes Int16 samples to a clean WAV file
    static func write(samples: [Int16], format: Format = standardFormat, to url: URL) throws {
        guard !samples.isEmpty else {
            throw Error.emptyData
        }

        guard samples.count >= minSamples else {
            throw Error.fileTooShort(minSamples: minSamples, actualSamples: samples.count)
        }

        let dataSize = UInt32(samples.count * 2)  // 2 bytes per Int16
        let header = buildHeader(format: format, dataSize: dataSize)

        // Convert samples to Data
        var pcmData = Data(capacity: samples.count * 2)
        for sample in samples {
            pcmData.append(littleEndian: sample)
        }

        // Write header + PCM data
        do {
            try (header + pcmData).write(to: url)
        } catch {
            throw Error.writeError(underlying: error)
        }
    }

    /// Exports a clean WAV from any audio file AVAudioFile can read (including iOS WAV, CAF)
    static func exportCleanWAV(from sourceURL: URL, to destinationURL: URL) throws {
        let inputFile: AVAudioFile
        do {
            inputFile = try AVAudioFile(forReading: sourceURL)
        } catch {
            throw Error.readError(underlying: error)
        }

        let totalFrames = AVAudioFrameCount(inputFile.length)

        guard totalFrames > 0 else {
            throw Error.emptyData
        }

        guard totalFrames >= AVAudioFrameCount(minSamples) else {
            throw Error.fileTooShort(minSamples: minSamples, actualSamples: Int(totalFrames))
        }

        // Source format from file
        let sourceFormat = inputFile.processingFormat

        // Always output mono 16-bit - AVAudioConverter handles stereo-to-mono downmix
        guard let monoInt16Format = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sourceFormat.sampleRate,
            channels: 1,
            interleaved: true
        ) else {
            throw Error.readError(underlying: NSError(domain: "WAVWriter", code: -1, userInfo: [NSLocalizedDescriptionKey: "Cannot create mono Int16 format"]))
        }

        // Read source into float buffer
        guard let floatBuffer = AVAudioPCMBuffer(pcmFormat: sourceFormat, frameCapacity: totalFrames) else {
            throw Error.readError(underlying: NSError(domain: "WAVWriter", code: -2, userInfo: [NSLocalizedDescriptionKey: "Cannot create float buffer"]))
        }

        do {
            try inputFile.read(into: floatBuffer)
        } catch {
            throw Error.readError(underlying: error)
        }

        // Create mono Int16 buffer for output
        guard let int16Buffer = AVAudioPCMBuffer(pcmFormat: monoInt16Format, frameCapacity: totalFrames) else {
            throw Error.readError(underlying: NSError(domain: "WAVWriter", code: -3, userInfo: [NSLocalizedDescriptionKey: "Cannot create int16 buffer"]))
        }

        // Convert to mono Int16 (AVAudioConverter handles stereo-to-mono mixing)
        guard let converter = AVAudioConverter(from: sourceFormat, to: monoInt16Format) else {
            throw Error.readError(underlying: NSError(domain: "WAVWriter", code: -4, userInfo: [NSLocalizedDescriptionKey: "Cannot create converter"]))
        }

        var conversionError: NSError?
        converter.convert(to: int16Buffer, error: &conversionError) { _, outStatus in
            outStatus.pointee = .haveData
            return floatBuffer
        }

        if let error = conversionError {
            throw Error.readError(underlying: error)
        }

        int16Buffer.frameLength = floatBuffer.frameLength

        // Output format is always mono
        let format = Format(
            sampleRate: UInt32(sourceFormat.sampleRate),
            channels: 1,
            bitsPerSample: 16
        )

        // Build WAV file
        let dataSize = UInt32(int16Buffer.frameLength) * UInt32(format.blockAlign)
        let header = buildHeader(format: format, dataSize: dataSize)

        // Get raw bytes from buffer
        guard let channelData = int16Buffer.int16ChannelData else {
            throw Error.readError(underlying: NSError(domain: "WAVWriter", code: -5, userInfo: [NSLocalizedDescriptionKey: "No int16 channel data"]))
        }

        let pcmData = Data(bytes: channelData[0], count: Int(dataSize))

        // Write to destination
        do {
            try (header + pcmData).write(to: destinationURL)
        } catch {
            throw Error.writeError(underlying: error)
        }
    }
}

// MARK: - Data Extension for Little-Endian Writing

private extension Data {
    mutating func append<T: FixedWidthInteger>(littleEndian value: T) {
        var littleEndian = value.littleEndian
        append(Data(bytes: &littleEndian, count: MemoryLayout<T>.size))
    }
}
