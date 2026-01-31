import XCTest
@testable import PorizoApp

final class WAVWriterTests: XCTestCase {

    func testBuildHeaderReturns44Bytes() throws {
        // Will fail - WAVWriter doesn't exist yet
        let header = WAVWriter.buildHeader(
            sampleRate: 44100,
            channels: 1,
            bitsPerSample: 16,
            dataSize: 1000
        )
        XCTAssertEqual(header.count, 44)
    }
}
