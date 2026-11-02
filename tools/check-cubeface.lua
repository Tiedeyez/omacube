#!/usr/bin/env lua
-- Check the maths of the Omacube cube-face tiling (theme/omacube/cubeface.lua)
-- with plain Lua 5.4: no Hyprland needed.
--   lua tools/check-cubeface.lua        (exit status 0 = all checks pass)

local here = (arg and arg[0] or ""):match("^(.*)/[^/]*$") or "."
local M = dofile(here .. "/../theme/omacube/cubeface.lua")

local failures = 0
local function check(name, ok, detail)
  print(string.format("%s  %s%s", ok and "PASS" or "FAIL", name, detail and ("  (" .. detail .. ")") or ""))
  if not ok then failures = failures + 1 end
end

local function compose(a, b)          -- apply a, then b
  local m = {}
  for s = 0, 8 do m[s] = b[a[s]] end
  return m
end
local function power(m, n)
  local p = {}
  for s = 0, 8 do p[s] = s end
  for _ = 1, n do p = compose(p, m) end
  return p
end
local function is_identity(m)
  for s = 0, 8 do if m[s] ~= s then return false end end
  return true
end
local function is_permutation(m)
  local seen = {}
  for s = 0, 8 do
    if m[s] == nil or m[s] < 0 or m[s] > 8 or seen[m[s]] then return false end
    seen[m[s]] = true
  end
  return true
end

-- ---- moves -----------------------------------------------------------------------
local moves = { ["face cw"] = M.face(1), ["face ccw"] = M.face(-1) }
for r = 0, 2 do moves["row " .. r .. " right"] = M.row(r, 1); moves["row " .. r .. " left"] = M.row(r, -1) end
for c = 0, 2 do moves["column " .. c .. " down"] = M.column(c, 1); moves["column " .. c .. " up"] = M.column(c, -1) end
local allperm = true
for _, m in pairs(moves) do allperm = allperm and is_permutation(m) end
check("every move is a permutation of the nine slots", allperm)

local F, Fi = M.face(1), M.face(-1)
check("four clockwise face turns are the identity", is_identity(power(F, 4)))
check("clockwise then counter-clockwise is the identity", is_identity(compose(F, Fi)))
check("a face turn keeps the centre in place", F[4] == 4)
check("a face turn cycles the corners 0>2>8>6>0", F[0] == 2 and F[2] == 8 and F[8] == 6 and F[6] == 0)
check("a face turn cycles the edges 1>5>7>3>1", F[1] == 5 and F[5] == 7 and F[7] == 3 and F[3] == 1)
check("a face turn is not its own inverse (order 4, not 2)", not is_identity(power(F, 2)))

local slides = true
for r = 0, 2 do
  slides = slides and is_identity(power(M.row(r, 1), 3)) and is_identity(compose(M.row(r, 1), M.row(r, -1)))
  slides = slides and is_identity(power(M.column(r, 1), 3)) and is_identity(compose(M.column(r, 1), M.column(r, -1)))
end
check("three row or column turns are the identity, and left undoes right", slides)
local local_only = true
for r = 0, 2 do
  local m = M.row(r, 1)
  for s = 0, 8 do
    if s // 3 ~= r and m[s] ~= s then local_only = false end
    if s // 3 == r and m[s] // 3 ~= r then local_only = false end
  end
end
check("a row turn moves only that row, and keeps it a row", local_only)

-- A face turn must move windows exactly as a 90 degree rotation moves the
-- stickers: rotating each window's box centre about the face centre lands
-- on the centre of the box that window gets after the turn.
local area = { x = 0, y = 0, w = 900, h = 900 }
local full = {}
for s = 0, 8 do full[s] = "w" .. s end
local before = M.boxes(full, area)
local after = M.boxes(M.apply(full, F), area)
local geometric = true
for s = 0, 8 do
  local id = "w" .. s
  local b, a = before[id], after[id]
  local cx, cy = b.x + b.w / 2 - 450, b.y + b.h / 2 - 450      -- screen y points down
  local rx, ry = -cy, cx                                        -- clockwise on screen
  if math.abs(a.x + a.w / 2 - 450 - rx) > 1e-9 or math.abs(a.y + a.h / 2 - 450 - ry) > 1e-9 then geometric = false end
end
check("a face turn moves every window like a 90-degree rotation of the face", geometric)

-- ---- the group the turns generate --------------------------------------------------
-- Every turn is an even permutation of the nine slots (a face turn is two
-- 4-cycles, a row or column turn a 3-cycle), so no sequence of turns can
-- swap just two windows: the same parity law that stops a real cube from
-- swapping two pieces on their own. Explore every arrangement the turns can
-- reach from one starting face and check it is exactly the even ones.
local gens = {}
for _, m in pairs(moves) do gens[#gens + 1] = m end
local function key(st) return table.concat(st) end
local start = { "1", "2", "3", "4", "5", "6", "7", "8", "9" }       -- window in slot s-1
local seen, queue, head = { [key(start)] = true }, { start }, 1
while head <= #queue do
  local st = queue[head]; head = head + 1
  for _, m in ipairs(gens) do
    local nx = {}
    for s = 0, 8 do nx[m[s] + 1] = st[s + 1] end
    local k = key(nx)
    if not seen[k] then seen[k] = true; queue[#queue + 1] = nx end
  end
end
local swapped = { "2", "1", "3", "4", "5", "6", "7", "8", "9" }
check("the turns reach exactly the 181,440 even arrangements (half of 9!)", #queue == 181440, #queue .. " reached")
check("no sequence of turns swaps just two windows (parity, as on a real cube)", not seen[key(swapped)])

-- ---- tiling ----------------------------------------------------------------------
local function check_cover(boxes, area)
  local total = 0
  local list = {}
  for id, b in pairs(boxes) do
    if b.w <= 0 or b.h <= 0 then return false, id .. " has no area" end
    if b.x < area.x or b.y < area.y or b.x + b.w > area.x + area.w or b.y + b.h > area.y + area.h then
      return false, id .. " leaves the face"
    end
    total = total + b.w * b.h
    list[#list + 1] = b
  end
  for i = 1, #list do
    for j = i + 1, #list do
      local a, b = list[i], list[j]
      if a.x < b.x + b.w and b.x < a.x + a.w and a.y < b.y + b.h and b.y < a.y + a.h then
        return false, "two windows overlap"
      end
    end
  end
  if total ~= area.w * area.h then return false, "windows cover " .. total .. " of " .. area.w * area.h end
  return true
end

local areas = { { x = 10, y = 46, w = 3420, h = 1384 }, { x = 0, y = 0, w = 1001, h = 777 }, { x = 5, y = 5, w = 7, h = 4 } }
local covered, tested = true, 0
for _, ar in ipairs(areas) do
  for pattern = 1, 511 do
    local slots, n = {}, 0
    for s = 0, 8 do
      if (pattern >> s) & 1 == 1 then slots[s] = "w" .. s; n = n + 1 end
    end
    local boxes = M.boxes(slots, ar)
    local count = 0
    for _ in pairs(boxes) do count = count + 1 end
    local ok, why = check_cover(boxes, ar)
    if not ok or count ~= n then
      covered = false
      print("      pattern " .. pattern .. ": " .. (why or ("windows " .. count .. " of " .. n)))
      break
    end
    tested = tested + 1
  end
end
check("every arrangement covers the face exactly: no gaps, no overlaps", covered, tested .. " arrangements on 3 screen sizes")

-- shapes for 1..9 windows arriving one by one
local expect = { "1", "2", "2+1", "2+2", "3+2", "3+3", "1+3+3", "2+3+3", "3+3+3" }
local slots, ids, shapes = {}, {}, true
for n = 1, 9 do
  ids[#ids + 1] = "w" .. n
  slots = M.sync(slots, ids)
  local boxes = M.boxes(slots, { x = 0, y = 0, w = 900, h = 900 })
  local rows = {}
  for _, b in pairs(boxes) do rows[b.y] = (rows[b.y] or 0) + 1 end
  local ys = {}
  for y in pairs(rows) do ys[#ys + 1] = y end
  table.sort(ys)
  local parts = {}
  for _, y in ipairs(ys) do parts[#parts + 1] = tostring(rows[y]) end
  local shape = table.concat(parts, "+")
  if shape ~= expect[n] then shapes = false; print("      " .. n .. " windows: " .. shape .. ", expected " .. expect[n]) end
end
check("windows arriving one by one grow from a full face to a 3x3 grid", shapes, table.concat(expect, ", "))

-- windows keep their slots when others come and go
local s1 = M.sync({}, { "a", "b", "c", "d" })
local s2 = M.sync(s1, { "a", "c", "d" })
local s3 = M.sync(s2, { "a", "c", "d", "e" })
local stable = s3[4] == "a" and s3[7] == "c" and s3[8] == "d" and s3[5] == "e"
check("windows keep their place; a newcomer takes the first free slot", stable)

-- more than nine windows: all placed, still an exact cover
local twelve = {}
for i = 1, 12 do twelve[i] = "w" .. i end
local sl, over = M.sync({}, twelve)
local bx = M.boxes(sl, { x = 0, y = 0, w = 1200, h = 900 }, over)
local n12 = 0
for _ in pairs(bx) do n12 = n12 + 1 end
local ok12 = check_cover(bx, { x = 0, y = 0, w = 1200, h = 900 })
check("a tenth window and beyond share the last slot, still covering exactly", n12 == 12 and ok12 and #over == 3)

-- messages
check("layout messages parse", M.move_for("face cw") ~= nil and M.move_for("face ccw") ~= nil
  and M.move_for("row left", 4) ~= nil and M.move_for("column up", 0) ~= nil
  and M.move_for("row left", nil) == nil and M.move_for("spin", 4) == nil)

print(failures == 0 and "\nall checks passed" or ("\n" .. failures .. " check(s) failed"))
os.exit(failures == 0 and 0 or 1)
