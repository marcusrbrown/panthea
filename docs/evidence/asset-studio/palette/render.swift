import AppKit
import CoreText
import Foundation
import ImageIO

struct Ramp: Decodable {
    let id: String
    let shades: [String]
}

struct Family: Decodable {
    let id: String
    let ramps: [Ramp]
}

struct Approval: Decodable {
    let status: String
}

struct Palette: Decodable {
    let families: [Family]
    let approval: Approval
}

struct RGB: Equatable {
    let r: UInt8
    let g: UInt8
    let b: UInt8
}

struct Canvas {
    let width: Int
    let height: Int
    let context: CGContext

    init(width: Int, height: Int) {
        self.width = width
        self.height = height
        let space = CGColorSpaceCreateDeviceRGB()
        self.context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: space,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        self.context.setAllowsAntialiasing(false)
        self.context.setShouldAntialias(false)
    }

    func fill(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ color: RGB) {
        context.setFillColor(red: CGFloat(color.r) / 255, green: CGFloat(color.g) / 255,
                             blue: CGFloat(color.b) / 255, alpha: 1)
        context.fill(CGRect(x: x, y: height - y - h, width: w, height: h))
    }

    func text(_ value: String, _ x: Int, _ top: Int, size: CGFloat = 18,
              color: RGB = RGB(r: 54, g: 51, b: 46), bold: Bool = false) {
        let fontName = bold ? "AvenirNext-DemiBold" : "AvenirNext-Regular"
        let font = CTFontCreateWithName(fontName as CFString, size, nil)
        let line = CTLineCreateWithAttributedString(NSAttributedString(
            string: value,
            attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font]
        ))
        context.setFillColor(red: CGFloat(color.r) / 255, green: CGFloat(color.g) / 255,
                             blue: CGFloat(color.b) / 255, alpha: 1)
        context.textPosition = CGPoint(x: x, y: height - top - Int(size))
        CTLineDraw(line, context)
    }

    func save(_ url: URL) throws {
        let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil)!
        CGImageDestinationAddImage(destination, context.makeImage()!, nil)
        guard CGImageDestinationFinalize(destination) else {
            throw NSError(domain: "PaletteRenderer", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Could not write \(url.path)"])
        }
    }
}

func rgb(_ hex: String) -> RGB {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return RGB(r: UInt8((value >> 16) & 255), g: UInt8((value >> 8) & 255), b: UInt8(value & 255))
}

func shade(_ familyID: String, _ rampID: String, _ index: Int) -> RGB {
    guard let family = palette.families.first(where: { $0.id == familyID }),
          let ramp = family.ramps.first(where: { $0.id == rampID }) else {
        fatalError("Missing palette ramp: \(familyID)/\(rampID)")
    }
    return rgb(ramp.shades[index])
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let paletteURL = root.appendingPathComponent("content/greek/palette/palette.json")
let data = try Data(contentsOf: paletteURL)
let palette = try JSONDecoder().decode(Palette.self, from: data)
let outputDir = root.appendingPathComponent("docs/evidence/asset-studio/palette")
try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

let paper = RGB(r: 242, g: 236, b: 222)
let ink = RGB(r: 52, g: 48, b: 43)
let muted = RGB(r: 112, g: 103, b: 91)
let rule = RGB(r: 202, g: 190, b: 169)

let board = Canvas(width: 1024, height: 1024)
board.fill(0, 0, board.width, board.height, paper)
board.text("PANTHEA  /  GREEK MASTER", 48, 24, size: 14, color: muted, bold: true)
board.text("Greek master palette", 48, 50, size: 29, color: ink, bold: true)
board.text("48 colours  ·  12 family ramps  ·  darkest → lightest  ·  \(palette.approval.status.uppercased())",
           50, 91, size: 13, color: muted)
board.fill(48, 118, 928, 1, rule)

let familyNotes: [String: String] = [
    "town": "sun-warmed earth  /  olive  /  terracotta  /  stone and open sky",
    "olympus": "cool marble  /  pale gold  /  lapis  /  high-key cloud",
    "underworld": "ash  /  desaturated violet  /  bone  /  restrained ember"
]
let familyColors: [String: RGB] = [
    "town": RGB(r: 164, g: 85, b: 60),
    "olympus": RGB(r: 60, g: 98, b: 144),
    "underworld": RGB(r: 105, g: 89, b: 107)
]

var y = 132
for family in palette.families {
    board.text(family.id.uppercased(), 48, y, size: 17, color: familyColors[family.id] ?? ink, bold: true)
    board.text(familyNotes[family.id] ?? "", 178, y + 2, size: 12, color: muted)
    y += 28
    for ramp in family.ramps {
        board.text(ramp.id.replacingOccurrences(of: "-", with: " "), 50, y + 10,
                   size: 13, color: ink, bold: true)
        for (index, shade) in ramp.shades.enumerated() {
            let x = 162 + index * 206
            board.fill(x, y, 194, 30, ink)
            board.fill(x + 2, y + 2, 190, 26, rgb(shade))
            board.text(shade.lowercased(), x + 4, y + 33, size: 11, color: muted)
        }
        y += 50
    }
    y += 12
    board.fill(48, y - 6, 928, 1, rule)
}
board.text("RGB values are the palette entries, not display approximations. Each row is an independent material ramp.",
           48, 884, size: 12, color: muted)
try board.save(outputDir.appendingPathComponent("palette-sheet.png"))

struct PixelArt {
    let width: Int
    let height: Int
    private(set) var pixels: [RGB?]

    init(width: Int, height: Int) {
        self.width = width
        self.height = height
        pixels = Array(repeating: nil, count: width * height)
    }

    mutating func fill(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ color: RGB) {
        precondition(x >= 0 && y >= 0 && x + w <= width && y + h <= height)
        for row in y ..< y + h {
            for column in x ..< x + w {
                pixels[row * width + column] = color
            }
        }
    }

    func colorAt(_ x: Int, _ y: Int) -> RGB? {
        pixels[y * width + x]
    }

    func draw(on canvas: Canvas, x: Int, y: Int, scale: Int) {
        precondition(scale >= 1)
        for row in 0 ..< height {
            var column = 0
            while column < width {
                guard let color = colorAt(column, row) else {
                    column += 1
                    continue
                }
                var end = column + 1
                while end < width && colorAt(end, row) == color {
                    end += 1
                }
                canvas.fill(x + column * scale, y + row * scale,
                            (end - column) * scale, scale, color)
                column = end
            }
        }
    }

    func occupiedBounds() -> (x: Int, y: Int, width: Int, height: Int)? {
        let occupied = pixels.indices.filter { pixels[$0] != nil }
        guard let first = occupied.first, let last = occupied.last else { return nil }
        let minX = occupied.map { $0 % width }.min()!
        let maxX = occupied.map { $0 % width }.max()!
        let minY = first / width
        let maxY = last / width
        return (minX, minY, maxX - minX + 1, maxY - minY + 1)
    }
}

func frame(_ canvas: Canvas, x: Int, y: Int, width: Int, height: Int, scale: Int, color: RGB) {
    let border = scale
    canvas.fill(x - border, y - border, width * scale + border * 2, border, color)
    canvas.fill(x - border, y + height * scale, width * scale + border * 2, border, color)
    canvas.fill(x - border, y, border, height * scale, color)
    canvas.fill(x + width * scale, y, border, height * scale, color)
}

struct FigureColors {
    let outline: RGB
    let hair: RGB
    let hairLight: RGB
    let skin: RGB
    let skinLight: RGB
    let skinShade: RGB
    let garment: RGB
    let garmentLight: RGB
    let garmentDark: RGB
    let accent: RGB
    let background: RGB
}

func makeFigure(_ c: FigureColors) -> PixelArt {
    var art = PixelArt(width: 64, height: 80)

    // A bearded, laurel-crowned Greek divinity in a draped chiton. The outline
    // occupies x=12...51 and y=12...65 inside the 64 × 80 god cell.

    art.fill(20, 14, 24, 18, c.outline)
    art.fill(22, 15, 20, 15, c.hair)
    art.fill(25, 17, 14, 13, c.skin)
    art.fill(26, 18, 9, 4, c.skinLight)
    art.fill(24, 19, 2, 7, c.hair)
    art.fill(38, 19, 2, 7, c.hair)
    art.fill(29, 23, 2, 1, c.outline); art.fill(35, 23, 2, 1, c.outline)
    art.fill(32, 24, 2, 3, c.skinShade)
    art.fill(28, 26, 10, 7, c.hair)
    art.fill(30, 28, 6, 2, c.hairLight)
    art.fill(31, 27, 4, 1, c.outline)
    art.fill(29, 31, 8, 3, c.hair)
    art.fill(29, 32, 8, 2, c.hairLight)
    art.fill(28, 32, 8, 4, c.skin)

    // Overlapping leaf clusters sit over the hair as one low band, not tufts.
    art.fill(20, 16, 24, 2, c.accent)
    art.fill(19, 15, 5, 2, c.accent); art.fill(22, 13, 5, 3, c.accent)
    art.fill(27, 12, 6, 4, c.accent); art.fill(32, 12, 6, 4, c.accent)
    art.fill(37, 13, 5, 3, c.accent); art.fill(41, 15, 5, 2, c.accent)

    art.fill(27, 34, 10, 5, c.outline)
    art.fill(28, 35, 8, 4, c.skin)
    art.fill(12, 37, 9, 17, c.outline); art.fill(14, 38, 5, 13, c.garmentDark)
    art.fill(43, 37, 9, 17, c.outline); art.fill(45, 38, 5, 13, c.garmentDark)
    art.fill(13, 51, 7, 5, c.skin); art.fill(44, 51, 7, 5, c.skinLight)

    art.fill(20, 36, 24, 22, c.outline)
    art.fill(18, 39, 28, 18, c.outline)
    art.fill(16, 51, 32, 10, c.outline)
    art.fill(20, 38, 24, 18, c.garment)
    art.fill(19, 42, 26, 13, c.garment)
    art.fill(18, 53, 28, 6, c.garment)
    art.fill(21, 39, 6, 15, c.garmentLight)
    art.fill(26, 39, 3, 17, c.garmentDark)
    art.fill(35, 39, 3, 17, c.garmentLight)
    art.fill(39, 39, 5, 15, c.garmentDark)
    art.fill(30, 38, 4, 3, c.accent)
    art.fill(31, 41, 2, 16, c.accent)
    art.fill(23, 58, 18, 2, c.garmentDark)

    art.fill(21, 60, 7, 5, c.outline); art.fill(36, 60, 7, 5, c.outline)
    art.fill(20, 63, 9, 3, c.hair); art.fill(35, 63, 9, 3, c.hair)
    art.fill(21, 64, 7, 1, c.accent); art.fill(36, 64, 7, 1, c.accent)
    return art
}

func makePortrait(_ c: FigureColors) -> PixelArt {
    var art = PixelArt(width: 96, height: 96)
    art.fill(0, 0, 96, 96, c.background)

    art.fill(14, 59, 68, 37, c.outline)
    art.fill(18, 62, 60, 34, c.garment)
    art.fill(22, 65, 52, 31, c.garmentLight)
    art.fill(22, 65, 14, 25, c.garmentDark)
    art.fill(60, 65, 14, 25, c.garmentDark)
    art.fill(45, 61, 6, 31, c.accent)
    art.fill(46, 66, 4, 25, c.garmentDark)

    art.fill(27, 14, 42, 45, c.outline)
    art.fill(30, 17, 36, 40, c.hair)
    art.fill(34, 22, 28, 31, c.skin)
    art.fill(36, 24, 18, 10, c.skinLight)
    art.fill(31, 27, 5, 20, c.hair)
    art.fill(56, 27, 5, 20, c.hair)
    art.fill(38, 37, 4, 2, c.outline); art.fill(53, 37, 4, 2, c.outline)
    art.fill(45, 41, 3, 7, c.skinShade)
    art.fill(41, 48, 12, 3, c.outline)
    art.fill(38, 49, 18, 10, c.hair)
    art.fill(41, 52, 12, 4, c.hairLight)
    art.fill(43, 57, 8, 5, c.hair)

    // Portrait-scale leaves connect across the brow as one continuous wreath.
    art.fill(29, 19, 38, 3, c.accent)
    art.fill(28, 18, 8, 2, c.accent); art.fill(33, 15, 8, 5, c.accent)
    art.fill(40, 14, 9, 6, c.accent); art.fill(48, 15, 8, 5, c.accent)
    art.fill(56, 18, 8, 2, c.accent)
    return art
}

func figureColors(_ family: String) -> FigureColors {
    switch family {
    case "town":
        return FigureColors(outline: shade("town", "soil", 0), hair: shade("town", "soil", 0),
                            hairLight: shade("town", "soil", 1), skin: shade("town", "soil", 2),
                            skinLight: shade("town", "soil", 3), skinShade: shade("town", "soil", 1),
                            garment: shade("town", "terracotta", 2), garmentLight: shade("town", "terracotta", 3),
                            garmentDark: shade("town", "terracotta", 1), accent: shade("town", "olive", 2),
                            background: shade("town", "stone-sky", 2))
    case "olympus":
        return FigureColors(outline: shade("olympus", "lapis", 0), hair: shade("olympus", "lapis", 0),
                            hairLight: shade("olympus", "lapis", 1), skin: shade("olympus", "pale-gold", 2),
                            skinLight: shade("olympus", "pale-gold", 3), skinShade: shade("olympus", "pale-gold", 0),
                            garment: shade("olympus", "marble", 1), garmentLight: shade("olympus", "marble", 3),
                            garmentDark: shade("olympus", "lapis", 2), accent: shade("olympus", "pale-gold", 1),
                            background: shade("olympus", "cloud", 2))
    default:
        return FigureColors(outline: shade("underworld", "violet", 0), hair: shade("underworld", "violet", 0),
                            hairLight: shade("underworld", "violet", 1), skin: shade("underworld", "bone", 2),
                            skinLight: shade("underworld", "bone", 3), skinShade: shade("underworld", "bone", 1),
                            garment: shade("underworld", "violet", 2), garmentLight: shade("underworld", "violet", 3),
                            garmentDark: shade("underworld", "violet", 1), accent: shade("underworld", "ember", 3),
                            background: shade("underworld", "ash", 2))
    }
}

func borderedSwatch(_ canvas: Canvas, x: Int, y: Int, width: Int, height: Int, color: RGB) {
    canvas.fill(x, y, width, height, ink)
    canvas.fill(x + 2, y + 2, width - 4, height - 4, color)
}

func makeSheet(_ family: String, _ colors: FigureColors) throws {
    let canvas = Canvas(width: 960, height: 1024)
    canvas.fill(0, 0, canvas.width, canvas.height, paper)
    let figureArt = makeFigure(colors)
    let bounds = figureArt.occupiedBounds()!
    precondition(bounds.x == 12 && bounds.y == 12 && bounds.width == 40 && bounds.height == 54)
    canvas.text("GREEK PIXEL STUDY  /  \(family.uppercased())", 48, 27, size: 14,
                color: familyColors[family] ?? ink, bold: true)
    canvas.text("Illustrative figure, not a canon character", 48, 52, size: 25, color: ink, bold: true)
    canvas.text("God cell 64 × 80 px  ·  figure bounds x \(bounds.x)–\(bounds.x + bounds.width - 1), y \(bounds.y)–\(bounds.y + bounds.height - 1)",
                50, 90, size: 14, color: muted)
    canvas.fill(48, 118, 864, 1, rule)
    canvas.text("WORLD FIGURE", 48, 136, size: 15, color: ink, bold: true)
    canvas.text("1× native cell", 60, 162, size: 12, color: muted)
    canvas.text("4× nearest-neighbour", 180, 162, size: 12, color: muted)

    let figureSource = (x: 60, y: 190, width: 64, height: 80, scale: 1)
    let figureZoom = (x: 180, y: 190, width: 256, height: 320, scale: 4)
    figureArt.draw(on: canvas, x: figureSource.x, y: figureSource.y, scale: figureSource.scale)
    figureArt.draw(on: canvas, x: figureZoom.x, y: figureZoom.y, scale: figureZoom.scale)
    frame(canvas, x: figureSource.x, y: figureSource.y, width: figureSource.width,
          height: figureSource.height, scale: figureSource.scale, color: ink)
    frame(canvas, x: figureZoom.x, y: figureZoom.y, width: figureSource.width,
          height: figureSource.height, scale: figureZoom.scale, color: ink)

    canvas.text("ROLE COLOURS", 500, 184, size: 13, color: ink, bold: true)
    let roles: [(String, RGB)] = [
        ("hair / outline", colors.hair), ("skin", colors.skin), ("skin highlight", colors.skinLight),
        ("chiton", colors.garment), ("chiton light", colors.garmentLight), ("laurel", colors.accent)
    ]
    for (index, (label, color)) in roles.enumerated() {
        let y = 216 + index * 42
        borderedSwatch(canvas, x: 500, y: y, width: 56, height: 26, color: color)
        canvas.text(label, 570, y + 5, size: 12, color: muted)
    }
    canvas.text("Same pixel geometry in", 500, 498, size: 12, color: muted)
    canvas.text("each realm; colours vary", 500, 516, size: 12, color: muted)

    canvas.fill(48, 540, 864, 1, rule)
    canvas.text("PORTRAIT CROP", 48, 558, size: 15, color: ink, bold: true)
    canvas.text("1×  ·  96 × 96", 60, 584, size: 12, color: muted)
    canvas.text("3× nearest-neighbour", 210, 584, size: 12, color: muted)

    let portraitArt = makePortrait(colors)
    let portraitSource = (x: 60, y: 612, width: 96, height: 96, scale: 1)
    let portraitZoom = (x: 210, y: 612, width: 288, height: 288, scale: 3)
    portraitArt.draw(on: canvas, x: portraitSource.x, y: portraitSource.y, scale: portraitSource.scale)
    portraitArt.draw(on: canvas, x: portraitZoom.x, y: portraitZoom.y, scale: portraitZoom.scale)
    frame(canvas, x: portraitSource.x, y: portraitSource.y, width: portraitSource.width,
          height: portraitSource.height, scale: portraitSource.scale, color: ink)
    frame(canvas, x: portraitZoom.x, y: portraitZoom.y, width: portraitSource.width,
          height: portraitSource.height, scale: portraitZoom.scale, color: ink)

    canvas.text("96 × 96 is the portrait canvas.", 540, 646, size: 12, color: muted)
    canvas.text("The bust uses the same face, hair,", 540, 668, size: 12, color: muted)
    canvas.text("laurel, and chiton design as the", 540, 690, size: 12, color: muted)
    canvas.text("world figure, with portrait-scale", 540, 712, size: 12, color: muted)
    canvas.text("clusters. No redraw between realms.", 540, 734, size: 12, color: muted)

    canvas.fill(48, 932, 864, 1, rule)
    canvas.text("Exact pixel crops are checked against the saved PNG. View at 100% for native 1× pixels.",
                48, 954, size: 12, color: muted)
    canvas.text("Study art only; no asset or character is being submitted as canon.", 48, 978,
                size: 12, color: muted)
    try canvas.save(outputDir.appendingPathComponent("\(family)-study.png"))
}

let realms = ["town", "olympus", "underworld"]
for realm in realms {
    try makeSheet(realm, figureColors(realm))
}

let overview = Canvas(width: 960, height: 440)
overview.fill(0, 0, overview.width, overview.height, paper)
overview.text("GREEK PALETTE  /  PIXEL STUDIES", 48, 26, size: 14, color: muted, bold: true)
overview.text("Native-size figure samples", 48, 52, size: 27, color: ink, bold: true)
overview.text("Same original figure geometry in each realm; all samples are illustrative, not canon.",
               50, 92, size: 13, color: muted)
overview.fill(48, 120, 864, 1, rule)

for (index, realm) in realms.enumerated() {
    let x = 48 + index * 294
    let colors = figureColors(realm)
    overview.text(realm.uppercased(), x, 142, size: 16, color: familyColors[realm] ?? ink, bold: true)
    overview.text("64×80 cell · 1×", x + 3, 174, size: 10, color: muted)
    overview.text("96×96 crop · 1×", x + 110, 174, size: 10, color: muted)
    let figureArt = makeFigure(colors)
    figureArt.draw(on: overview, x: x + 3, y: 198, scale: 1)
    frame(overview, x: x + 3, y: 198, width: 64, height: 80, scale: 1, color: ink)
    let portraitArt = makePortrait(colors)
    portraitArt.draw(on: overview, x: x + 110, y: 198, scale: 1)
    frame(overview, x: x + 110, y: 198, width: 96, height: 96, scale: 1, color: ink)
}
overview.fill(48, 326, 864, 1, rule)
overview.text("Detailed 4× figure and 3× portrait comparisons: town-study.png · olympus-study.png · underworld-study.png",
               48, 348, size: 12, color: muted)
overview.text("Each enlargement is made from one native pixel grid by integer pixel replication.",
               48, 372, size: 12, color: muted)
try overview.save(outputDir.appendingPathComponent("scale-studies.png"))
