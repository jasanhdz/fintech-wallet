import AppKit
import CryptoKit
import Foundation
import Vision

let fileManager = FileManager.default
let repoRoot = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let inputRoot = repoRoot.appendingPathComponent("design", isDirectory: true)
let defaultOutputRoot = repoRoot.appendingPathComponent("docs/design/references/round3/source", isDirectory: true)
let outputRoot = ProcessInfo.processInfo.environment["DESIGN_SANITIZER_OUTPUT_ROOT"].map {
  URL(fileURLWithPath: $0, isDirectory: true)
} ?? defaultOutputRoot

func digest(_ url: URL) throws -> String {
  let data = try Data(contentsOf: url)
  return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

func containsSensitiveLiteral(_ text: String) -> Bool {
  if text.contains("@") { return true }
  let digits = text.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) }.count
  guard digits > 0 else { return false }
  if digits >= 3 { return true }

  let hasLetters = text.unicodeScalars.contains { CharacterSet.letters.contains($0) }
  let numericOnly = !hasLetters
  if numericOnly { return true }

  let patterns = [
    #"(?:\$|MXN\s*)\s*\d"#,
    #"(?:[•*x]\s*){2,}\d{3,}"#,
    #"[A-Za-z]{2,}[-#:]\s*[A-Za-z0-9-]*\d{3,}"#,
    #"\d{3,}\s*$"#,
    #"\b\d{10,}\b"#,
    #"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"#,
    #"\b(?:folio|ref(?:erencia)?|código|codigo|cuenta|clabe)\b[^0-9]{0,40}\d{3,}"#
  ]
  return patterns.contains { text.range(of: $0, options: [.regularExpression, .caseInsensitive]) != nil }
}

func recognizedText(in url: URL) throws -> [VNRecognizedTextObservation] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  request.automaticallyDetectsLanguage = true
  try VNImageRequestHandler(url: url).perform([request])
  return request.results ?? []
}

func redact(_ source: URL, to destination: URL) throws -> Int {
  guard let image = NSImage(contentsOf: source) else {
    throw NSError(domain: "DesignReferenceSanitizer", code: 1)
  }
  var proposedRect = NSRect(origin: .zero, size: image.size)
  guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
    throw NSError(domain: "DesignReferenceSanitizer", code: 2)
  }
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: cgImage.width,
    pixelsHigh: cgImage.height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else { throw NSError(domain: "DesignReferenceSanitizer", code: 3) }

  let observations = try recognizedText(in: source)
  let targets = observations.compactMap { observation -> CGRect? in
    guard let candidate = observation.topCandidates(1).first,
          containsSensitiveLiteral(candidate.string) else { return nil }
    return observation.boundingBox
  }

  NSGraphicsContext.saveGraphicsState()
  let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
  NSGraphicsContext.current = graphics
  image.draw(in: NSRect(x: 0, y: 0, width: bitmap.pixelsWide, height: bitmap.pixelsHigh), from: .zero, operation: .copy, fraction: 1)
  for box in targets {
    let x = max(0, Int(floor(box.minX * CGFloat(bitmap.pixelsWide))) - 4)
    let y = max(0, Int(floor(box.minY * CGFloat(bitmap.pixelsHigh))) - 4)
    let width = min(bitmap.pixelsWide - x, Int(ceil(box.width * CGFloat(bitmap.pixelsWide))) + 8)
    let height = min(bitmap.pixelsHigh - y, Int(ceil(box.height * CGFloat(bitmap.pixelsHigh))) + 8)
    guard width > 0, height > 0 else { continue }

    let sampleX = x > 4 ? x - 3 : min(bitmap.pixelsWide - 1, x + width + 3)
    let sampleY = min(bitmap.pixelsHigh - 1, max(0, y + height / 2))
    let background = bitmap.colorAt(x: sampleX, y: sampleY)?.usingColorSpace(.deviceRGB) ?? .white
    background.setFill()
    NSBezierPath(rect: NSRect(x: x, y: y, width: width, height: height)).fill()
  }
  graphics.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()

  try fileManager.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "DesignReferenceSanitizer", code: 4)
  }
  try data.write(to: destination, options: .atomic)
  return targets.count
}

var manifest = ["source\toutput\tmasked_text_regions\tremaining_ocr_candidates\tsource_sha256\toutput_sha256"]
var fileCount = 0
var maskCount = 0
var residualCount = 0
let limit = ProcessInfo.processInfo.environment["DESIGN_SANITIZER_LIMIT"].flatMap(Int.init) ?? Int.max
let match = ProcessInfo.processInfo.environment["DESIGN_SANITIZER_MATCH"]

for platform in ["web", "mobile"] {
  let platformRoot = inputRoot.appendingPathComponent(platform, isDirectory: true)
  guard let enumerator = fileManager.enumerator(at: platformRoot, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles]) else {
    throw NSError(domain: "DesignReferenceSanitizer", code: 5)
  }
  let sources = enumerator.compactMap { $0 as? URL }
    .filter { $0.pathExtension.lowercased() == "png" }
    .filter { match == nil || $0.path.contains(match!) }
    .sorted { $0.path < $1.path }

  for source in sources.prefix(limit) {
    if fileCount >= limit { break }
    let relative = String(source.path.dropFirst(platformRoot.path.count + 1))
    let destination = outputRoot.appendingPathComponent(platform, isDirectory: true).appendingPathComponent(relative)
    let masks = try redact(source, to: destination)
    let residuals = try recognizedText(in: destination).filter {
      $0.topCandidates(1).first.map { containsSensitiveLiteral($0.string) } ?? false
    }
    fileCount += 1
    maskCount += masks
    residualCount += residuals.count
    manifest.append("\(platform)/\(relative)\t\(String(destination.path.dropFirst(repoRoot.path.count + 1)))\t\(masks)\t\(residuals.count)\t\(try digest(source))\t\(try digest(destination))")
    if !residuals.isEmpty {
      let details = residuals.compactMap { observation -> String? in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        let digits = text.unicodeScalars.filter { CharacterSet.decimalDigits.contains($0) }.count
        let letters = text.unicodeScalars.contains { CharacterSet.letters.contains($0) }
        let box = observation.boundingBox
        return "digits=\(digits),letters=\(letters),box=\(Int(box.minX * 1000)),\(Int(box.minY * 1000)),\(Int(box.width * 1000)),\(Int(box.height * 1000))"
      }.joined(separator: ";")
      FileHandle.standardError.write(Data("Residual digit/email OCR detections in \(platform)/\(relative): \(details)\n".utf8))
    }
  }
}

try fileManager.createDirectory(at: outputRoot, withIntermediateDirectories: true)
try manifest.joined(separator: "\n").appending("\n").write(to: outputRoot.appendingPathComponent("manifest.tsv"), atomically: true, encoding: .utf8)
print("Sanitized \(fileCount) PNG references; masked \(maskCount) text regions; residual numeric/email OCR detections: \(residualCount).")
