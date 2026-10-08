-- Build the idle/south four-frame 1px breathing bob from the picked sprite.
-- The only cleanup is removal of the four background-colour pixels enclosed
-- between the feet; the bob translates the upper silhouette, not the legs.
local sprite = app.activeSprite
assert(sprite ~= nil, "studio sprite workspace is not open")
assert(sprite.width == 64 and sprite.height == 80, "expected 64x80 sprite cells")
assert(#sprite.frames == 1, "expected the single picked keyframe")
assert(#sprite.cels == 1, "expected one picked sprite cel")

local cel = sprite.cels[1]
local layer = cel.layer
local source = cel.image
assert(source.width == 64 and source.height == 80, "picked keyframe is invalid")

-- These four opaque background-colour pixels sit between the two feet. The
-- report-only gate identified them as removable key background, so clear only
-- this exact 1x4 stray column before building the frames.
local transparent = Color{ r = 0, g = 0, b = 0, a = 0 }
for y = 76, 79 do source:putPixel(32, y, transparent) end

local function frameImage(raiseUpper)
  local image = Image(64, 80, ColorMode.RGB)
  for y = 0, 79 do
    for x = 0, 63 do
      local pixel = source:getPixel(x, y)
      if raiseUpper then
        if y > 0 and y < 70 then image:putPixel(x, y - 1, pixel) end
        -- Duplicate the shared boundary row to keep the torso connected while
        -- the lower robe, legs, and feet remain exactly at their base position.
        if y >= 69 then image:putPixel(x, y, pixel) end
      else
        image:putPixel(x, y, pixel)
      end
    end
  end
  return image
end

local durations = { 0.167, 0.166, 0.167, 0.166 }
local frameImages = { source, frameImage(true), frameImage(true), frameImage(false) }
sprite.frames[1].duration = durations[1]
for index = 2, 4 do
  local frame = sprite:newEmptyFrame()
  frame.duration = durations[index]
  sprite:newCel(layer, index, frameImages[index], Point(0, 0))
end

assert(#sprite.frames == 4, "expected four idle frames")
local tag = sprite.tags[1]
assert(tag ~= nil and tag.name == "idle/south", "expected the idle/south tag")
tag.fromFrame = sprite.frames[1]
tag.toFrame = sprite.frames[4]
tag.repeats = 0

local slice = sprite:newSlice(Rectangle(0, 0, 64, 80))
slice.name = "pivot:idle/south"
slice.pivot = Point(32, 80)

local output = sprite.filename
assert(output ~= nil and output ~= "", "Aseprite did not provide the workspace filename")
sprite:saveAs(output)
print("R8_BOB=4-frames;upper-body-1px-rise-on-frames-2-and-3;lower-robe-legs-feet-fixed;durations=167,166,167,166;pivot=32,80;removed-only-4-enclosed-background-pixels")
