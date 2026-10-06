-- Builds an RGB Aseprite workspace from a studio sheet and prints what it
-- stored. Params (all required): sheet, gpl, out, cellw, cellh, durations
-- (milliseconds, comma separated), tags (name:from:to, 1-based, comma
-- separated), pivots (slot:x:y, comma separated, may be empty).
-- Only the Sprite, Image, Palette and Slice APIs are used; the sandboxed
-- script never touches the filesystem or the process.
local p = app.params
local cellw = tonumber(p.cellw)
local cellh = tonumber(p.cellh)

local durations = {}
for value in string.gmatch(p.durations, "[^,]+") do
  durations[#durations + 1] = tonumber(value)
end

local sprite = Sprite(cellw, cellh, ColorMode.RGB)
app.sprite = sprite
sprite:setPalette(Palette{ fromFile = p.gpl })

local strip = Image{ fromFile = p.sheet }
local layer = sprite.layers[1]
layer.name = "frames"
for i = 2, #durations do sprite:newEmptyFrame() end

for i = 1, #durations do
  local image = Image(cellw, cellh, ColorMode.RGB)
  local offset = (i - 1) * cellw
  for y = 0, cellh - 1 do
    for x = 0, cellw - 1 do
      image:putPixel(x, y, strip:getPixel(offset + x, y))
    end
  end
  sprite:newCel(layer, i, image, Point(0, 0))
  -- Aseprite counts durations in seconds; the studio keeps whole milliseconds.
  sprite.frames[i].duration = durations[i] / 1000
end

for entry in string.gmatch(p.tags, "[^,]+") do
  local name, from, to = string.match(entry, "^(.-):(%d+):(%d+)$")
  local tag = sprite:newTag(tonumber(from), tonumber(to))
  tag.name = name
  tag.repeats = 0
end

for entry in string.gmatch(p.pivots, "[^,]+") do
  local slot, x, y = string.match(entry, "^(.-):(%d+):(%d+)$")
  local slice = sprite:newSlice(Rectangle(0, 0, cellw, cellh))
  slice.name = "pivot:" .. slot
  slice.pivot = Point(tonumber(x), tonumber(y))
end

sprite:saveAs(p.out)

local out = {}
local function emit(key, value) out[#out + 1] = key .. "=" .. tostring(value) end
emit("rgb", sprite.colorMode == ColorMode.RGB)
emit("size", sprite.width .. "x" .. sprite.height)
emit("frames", #sprite.frames)
for i, frame in ipairs(sprite.frames) do
  emit("duration." .. i, math.floor(frame.duration * 1000 + 0.5))
end
for _, tag in ipairs(sprite.tags) do
  emit("tag." .. tag.name, tag.fromFrame.frameNumber .. "-" .. tag.toFrame.frameNumber .. " repeats=" .. tag.repeats)
end
for _, slice in ipairs(sprite.slices) do
  local pivot = slice.pivot
  emit("slice." .. slice.name, pivot and (pivot.x .. "," .. pivot.y) or "nil")
end
local palette = sprite.palettes[1]
emit("palette.count", #palette)
for i = 0, #palette - 1 do
  local c = palette:getColor(i)
  emit("palette." .. i, string.format("#%02x%02x%02x", c.red, c.green, c.blue))
end
print(table.concat(out, "\n"))
