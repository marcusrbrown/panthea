-- Apply the owner-approved portrait cleanup to the open studio edit workspace.
-- The generated eyes and everything outside the lower-face patch are untouched.
local sprite = app.activeSprite
assert(sprite ~= nil, "studio portrait workspace is not open")
assert(sprite.width == 96 and sprite.height == 96, "expected 96x96 portrait cells")
assert(#sprite.frames == 6, "expected the six ordered portrait slots")

local cels = {}
for _, cel in ipairs(sprite.cels) do
  cels[cel.frame.frameNumber] = cel
end
for frameIndex = 1, 6 do
  assert(cels[frameIndex] ~= nil, "a portrait frame has no cel")
end
local source = cels[1].image -- neutral is the shared face base
assert(source.width == 96 and source.height == 96, "neutral source cell is invalid")

local palette = {
  mouth = Color{ r = 118, g = 87, b = 47, a = 255 }, -- Olympus #76572f
  lip = Color{ r = 179, g = 139, b = 67, a = 255 }, -- Olympus #b38b43
}

-- Restore only the moustache/front-of-mouth area from the unedited neutral face.
-- This removes the generated white teeth clusters and stray orange/gold flecks.
local x0, x1, y0, y1 = 50, 65, 49, 56
for frameIndex = 2, 6 do
  local image = cels[frameIndex].image
  for y = y0, y1 do
    for x = x0, x1 do
      image:putPixel(x, y, source:getPixel(x, y))
    end
  end
end

local function paint(frameIndex, points, colour)
  local image = cels[frameIndex].image
  for _, point in ipairs(points) do
    image:putPixel(point[1], point[2], colour)
  end
end

-- Each shape is deliberately small and distinct; no eye, nose, outline, beard,
-- hairline, or head pixels outside the restoration patch are changed.
-- Pleased: broad curved smile.
paint(2, {
  { 53, 52 }, { 54, 53 }, { 55, 53 }, { 56, 53 }, { 57, 53 }, { 58, 52 },
}, palette.mouth)
paint(2, { { 54, 54 }, { 55, 55 }, { 56, 55 }, { 57, 54 } }, palette.lip)

-- Angry: short, compressed straight line.
paint(3, {
  { 54, 52 }, { 55, 52 }, { 56, 52 }, { 57, 52 }, { 58, 52 },
  { 55, 53 }, { 56, 53 },
}, palette.mouth)

-- Grieving: clear downturned mouth, distinct from the smile.
paint(4, {
  { 53, 54 }, { 54, 53 }, { 55, 52 }, { 56, 52 }, { 57, 53 }, { 58, 54 },
}, palette.mouth)
paint(4, { { 54, 55 }, { 55, 55 }, { 56, 55 }, { 57, 55 } }, palette.lip)

-- Scheming: one-sided rising smirk.
paint(5, {
  { 53, 53 }, { 54, 53 }, { 55, 52 }, { 56, 52 }, { 57, 51 }, { 58, 51 },
}, palette.mouth)
paint(5, { { 56, 53 }, { 57, 52 } }, palette.lip)

-- Awed: a small rectangular opening, not a round O.
paint(6, {
  { 55, 51 }, { 56, 51 }, { 57, 51 },
  { 55, 52 }, { 56, 52 }, { 57, 52 },
}, palette.mouth)
paint(6, { { 55, 53 }, { 56, 53 }, { 57, 53 } }, palette.lip)

sprite:saveAs(app.params.out)
print("R8_CLEANUP=mouths-distinct;teeth-and-flecks-removed;eyes-and-head-preserved;only-lower-face-pixels-edited")
