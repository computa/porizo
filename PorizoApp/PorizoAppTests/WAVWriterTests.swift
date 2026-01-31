import XCTest
@testable import PorizoApp

final class WAVWriterTests: XCTestCase {

    private var tempDirectory: URL!

    override func setUp() {
        super.setUp()
        tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try? FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: tempDirectory)
        super.tearDown()
    }

    private func tempURL(name: String = "test.wav") -> URL {
        tempDirectory.appendingPathComponent(name)
    }

    // MARK: - Header Structure Tests

    func testBuildHeaderReturns44Bytes() {
        let header = WAVWriter.buildHeader(
            sampleRate: 44100,
            channels: 1,
            bitsPerSample: 16,
            dataSize: 1000
        )
        XCTAssertEqual(header.count, 44, "WAV header must be exactly 44 bytes")
    }

    func testHeaderContainsRIFFSignature() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let riff = String(data: header[0..<4], encoding: .ascii)
        XCTAssertEqual(riff, "RIFF")
    }

    func testHeaderContainsWAVEFormat() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let wave = String(data: header[8..<12], encoding: .ascii)
        XCTAssertEqual(wave, "WAVE")
    }

    func testHeaderContainsFmtChunk() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let fmt = String(data: header[12..<16], encoding: .ascii)
        XCTAssertEqual(fmt, "fmt ")
    }

    func testHeaderContainsDataChunk() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let data = String(data: header[36..<40], encoding: .ascii)
        XCTAssertEqual(data, "data")
    }

    func testHeaderSampleRateIsLittleEndian() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let sampleRate = header.subdata(in: 24..<28).withUnsafeBytes { $0.load(as: UInt32.self) }
        XCTAssertEqual(sampleRate, 44100)
    }

    func testHeaderDataSizeMatchesInput() {
        let dataSize: UInt32 = 88200  // 1 second at 44.1kHz mono 16-bit
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: dataSize)
        let readSize = header.subdata(in: 40..<44).withUnsafeBytes { $0.load(as: UInt32.self) }
        XCTAssertEqual(readSize, dataSize)
    }

    func testHeaderFileSizeIsCorrect() {
        let dataSize: UInt32 = 1000
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: dataSize)
        let fileSize = header.subdata(in: 4..<8).withUnsafeBytes { $0.load(as: UInt32.self) }
        XCTAssertEqual(fileSize, 36 + dataSize, "File size should be 36 + dataSize")
    }

    func testHeaderAudioFormatIsPCM() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let audioFormat = header.subdata(in: 20..<22).withUnsafeBytes { $0.load(as: UInt16.self) }
        XCTAssertEqual(audioFormat, 1, "Audio format should be 1 (PCM)")
    }

    func testHeaderChannelCount() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 2, bitsPerSample: 16, dataSize: 100)
        let channels = header.subdata(in: 22..<24).withUnsafeBytes { $0.load(as: UInt16.self) }
        XCTAssertEqual(channels, 2)
    }

    func testHeaderBitsPerSample() {
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let bits = header.subdata(in: 34..<36).withUnsafeBytes { $0.load(as: UInt16.self) }
        XCTAssertEqual(bits, 16)
    }

    func testHeaderByteRate() {
        // ByteRate = SampleRate * NumChannels * BitsPerSample/8
        // 44100 * 1 * 16/8 = 88200
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let byteRate = header.subdata(in: 28..<32).withUnsafeBytes { $0.load(as: UInt32.self) }
        XCTAssertEqual(byteRate, 88200)
    }

    func testHeaderBlockAlign() {
        // BlockAlign = NumChannels * BitsPerSample/8
        // 1 * 16/8 = 2
        let header = WAVWriter.buildHeader(sampleRate: 44100, channels: 1, bitsPerSample: 16, dataSize: 100)
        let blockAlign = header.subdata(in: 32..<34).withUnsafeBytes { $0.load(as: UInt16.self) }
        XCTAssertEqual(blockAlign, 2)
    }

    // MARK: - Write Tests

    func testWriteCreatesFile() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let url = tempURL()

        try WAVWriter.write(samples: samples, to: url)

        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
    }

    func testWriteFileSizeIsCorrect() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let url = tempURL()

        try WAVWriter.write(samples: samples, to: url)

        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let size = attributes[.size] as! Int
        XCTAssertEqual(size, 44 + samples.count * 2, "File size should be 44-byte header + PCM data")
    }

    func testWriteDataOffsetIsExactly44() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let url = tempURL()

        try WAVWriter.write(samples: samples, to: url)

        let data = try Data(contentsOf: url)

        // Verify "data" chunk is at offset 36, so audio starts at 44
        let dataMarker = String(data: data[36..<40], encoding: .ascii)
        XCTAssertEqual(dataMarker, "data", "Data chunk should be at offset 36")
    }

    // MARK: - Error Handling Tests

    func testWriteEmptyDataThrowsError() {
        let samples: [Int16] = []

        XCTAssertThrowsError(try WAVWriter.write(samples: samples, to: tempURL())) { error in
            guard case WAVWriter.Error.emptyData = error else {
                XCTFail("Expected emptyData error, got \(error)")
                return
            }
        }
    }

    func testWriteTooShortThrowsError() {
        // Less than minSamples (22050 = 0.5s at 44.1kHz)
        let samples = [Int16](repeating: 0, count: 1000)

        XCTAssertThrowsError(try WAVWriter.write(samples: samples, to: tempURL())) { error in
            guard case WAVWriter.Error.fileTooShort(let minSamples, let actualSamples) = error else {
                XCTFail("Expected fileTooShort error, got \(error)")
                return
            }
            XCTAssertEqual(minSamples, WAVWriter.minSamples)
            XCTAssertEqual(actualSamples, 1000)
        }
    }

    // MARK: - Round-Trip Tests (Simulating Server Parse)

    func testRoundTripParsesCorrectly() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let url = tempURL()

        try WAVWriter.write(samples: samples, to: url)

        // Parse like server's parseWavBuffer
        let data = try Data(contentsOf: url)
        let parsed = parseWavHeader(data)

        XCTAssertEqual(parsed.sampleRate, 44100)
        XCTAssertEqual(parsed.channels, 1)
        XCTAssertEqual(parsed.bitsPerSample, 16)
        XCTAssertEqual(parsed.dataOffset, 44)
        XCTAssertEqual(parsed.dataSize, samples.count * 2)
    }

    func testRoundTripDurationCalculation() throws {
        let durationSeconds = 2.5
        let sampleRate = 44100
        let samples = generateSineWave(frequency: 440, durationSeconds: durationSeconds, sampleRate: sampleRate)
        let url = tempURL()

        try WAVWriter.write(samples: samples, to: url)

        let data = try Data(contentsOf: url)
        let parsed = parseWavHeader(data)

        // Calculate duration: dataSize / (channels * bytesPerSample) / sampleRate
        let calculatedDuration = Double(parsed.dataSize) / 2.0 / Double(parsed.sampleRate)
        XCTAssertEqual(calculatedDuration, durationSeconds, accuracy: 0.001)
    }

    // MARK: - Large File Tests

    func testLargeFileDoesNotCrash() throws {
        // 60 seconds of audio (should not cause memory issues)
        let sampleRate = 44100
        let samples = [Int16](repeating: 0, count: sampleRate * 60)
        let url = tempURL()

        try WAVWriter.write(samples: samples, to: url)

        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        let size = attributes[.size] as! Int
        XCTAssertEqual(size, 44 + samples.count * 2)
    }

    // MARK: - exportCleanWAV Tests

    func testExportCleanWAVCreatesFile() throws {
        // Create source WAV
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let sourceURL = tempURL(name: "source.wav")
        let destURL = tempURL(name: "clean.wav")

        try WAVWriter.write(samples: samples, to: sourceURL)

        // Export clean WAV
        try WAVWriter.exportCleanWAV(from: sourceURL, to: destURL)

        XCTAssertTrue(FileManager.default.fileExists(atPath: destURL.path))
    }

    func testExportCleanWAVProduces44ByteHeader() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let sourceURL = tempURL(name: "source.wav")
        let destURL = tempURL(name: "clean.wav")

        try WAVWriter.write(samples: samples, to: sourceURL)
        try WAVWriter.exportCleanWAV(from: sourceURL, to: destURL)

        let data = try Data(contentsOf: destURL)
        let parsed = parseWavHeader(data)

        XCTAssertEqual(parsed.dataOffset, 44, "Clean WAV should have data at offset 44")
    }

    func testExportCleanWAVPreservesAudioContent() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let sourceURL = tempURL(name: "source.wav")
        let destURL = tempURL(name: "clean.wav")

        try WAVWriter.write(samples: samples, to: sourceURL)
        try WAVWriter.exportCleanWAV(from: sourceURL, to: destURL)

        let data = try Data(contentsOf: destURL)
        let parsed = parseWavHeader(data)

        XCTAssertEqual(parsed.sampleRate, 44100)
        XCTAssertEqual(parsed.channels, 1)
        XCTAssertEqual(parsed.bitsPerSample, 16)
        // Duration should match (1 second = 88200 bytes at 44.1kHz mono 16-bit)
        XCTAssertEqual(parsed.dataSize, samples.count * 2)
    }

    func testExportCleanWAVOutputsMonoFromMono() throws {
        let samples = generateSineWave(frequency: 440, durationSeconds: 1.0, sampleRate: 44100)
        let sourceURL = tempURL(name: "source.wav")
        let destURL = tempURL(name: "clean.wav")

        try WAVWriter.write(samples: samples, to: sourceURL)
        try WAVWriter.exportCleanWAV(from: sourceURL, to: destURL)

        let data = try Data(contentsOf: destURL)
        let parsed = parseWavHeader(data)

        XCTAssertEqual(parsed.channels, 1, "Output should always be mono")
    }

    func testExportCleanWAVThrowsOnEmptyFile() throws {
        let sourceURL = tempURL(name: "empty.wav")

        // Create empty file
        FileManager.default.createFile(atPath: sourceURL.path, contents: Data(), attributes: nil)

        XCTAssertThrowsError(try WAVWriter.exportCleanWAV(from: sourceURL, to: tempURL(name: "dest.wav"))) { error in
            // Should throw readError since AVAudioFile can't read empty file
            guard case WAVWriter.Error.readError = error else {
                XCTFail("Expected readError, got \(error)")
                return
            }
        }
    }

    func testExportCleanWAVThrowsOnNonexistentFile() {
        let sourceURL = tempURL(name: "nonexistent.wav")
        let destURL = tempURL(name: "dest.wav")

        XCTAssertThrowsError(try WAVWriter.exportCleanWAV(from: sourceURL, to: destURL)) { error in
            guard case WAVWriter.Error.readError = error else {
                XCTFail("Expected readError, got \(error)")
                return
            }
        }
    }

    // MARK: - Format Tests

    func testStandardFormatIsCorrect() {
        let format = WAVWriter.standardFormat
        XCTAssertEqual(format.sampleRate, 44100)
        XCTAssertEqual(format.channels, 1)
        XCTAssertEqual(format.bitsPerSample, 16)
    }

    func testMinSamplesIsHalfSecond() {
        // 44100 * 0.5 = 22050
        XCTAssertEqual(WAVWriter.minSamples, 22050)
    }

    // MARK: - Helpers

    private func generateSineWave(frequency: Double, durationSeconds: Double, sampleRate: Int) -> [Int16] {
        let numSamples = Int(durationSeconds * Double(sampleRate))
        var samples = [Int16]()
        samples.reserveCapacity(numSamples)

        for i in 0..<numSamples {
            let t = Double(i) / Double(sampleRate)
            let value = sin(2 * .pi * frequency * t)
            samples.append(Int16(value * 32767))
        }

        return samples
    }

    /// Minimal WAV header parser (mirrors server's parseWavBuffer logic)
    private func parseWavHeader(_ data: Data) -> (sampleRate: Int, channels: Int, bitsPerSample: Int, dataOffset: Int, dataSize: Int) {
        guard data.count >= 44 else {
            return (0, 0, 0, 0, 0)
        }

        // Verify RIFF/WAVE
        guard String(data: data[0..<4], encoding: .ascii) == "RIFF",
              String(data: data[8..<12], encoding: .ascii) == "WAVE" else {
            return (0, 0, 0, 0, 0)
        }

        // Scan for fmt and data chunks
        var offset = 12
        var sampleRate = 0
        var channels = 0
        var bitsPerSample = 0
        var dataOffset = 0
        var dataSize = 0

        while offset < data.count - 8 {
            let chunkId = String(data: data[offset..<offset+4], encoding: .ascii) ?? ""
            let chunkSize = data.subdata(in: offset+4..<offset+8).withUnsafeBytes { $0.load(as: UInt32.self) }

            if chunkId == "fmt " {
                channels = Int(data.subdata(in: offset+10..<offset+12).withUnsafeBytes { $0.load(as: UInt16.self) })
                sampleRate = Int(data.subdata(in: offset+12..<offset+16).withUnsafeBytes { $0.load(as: UInt32.self) })
                bitsPerSample = Int(data.subdata(in: offset+22..<offset+24).withUnsafeBytes { $0.load(as: UInt16.self) })
            } else if chunkId == "data" {
                dataOffset = offset + 8
                dataSize = Int(chunkSize)
                break
            }

            offset += 8 + Int(chunkSize)
            if chunkSize % 2 == 1 { offset += 1 }  // Word alignment
        }

        return (sampleRate, channels, bitsPerSample, dataOffset, dataSize)
    }
}
