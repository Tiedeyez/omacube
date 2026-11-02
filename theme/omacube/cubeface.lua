-- Omacube cube-face tiling for Hyprland 0.56+ (the Lua layout API).
--
-- Each workspace is one 3x3 face of a puzzle cube. Its nine slots are
-- numbered like the face's stickers, row by row:
--
--     0 1 2
--     3 4 5
--     6 7 8
--
-- Every tiled window holds one slot. A new window takes the first free slot
-- in FILL order: the centre first, then outwards until the face is full.
-- To draw a face, rows and columns that hold no window collapse, and each
-- window spreads over the empty slots beside it in its row (to the right,
-- or to the left for the first window in a row). The windows always cover
-- the whole face, with no holes and no overlaps.
--
-- Cube turns move windows between slots exactly as turns move stickers:
--   face turn    rotates the face 90 degrees: the corners cycle 0>2>8>6,
--                the edges cycle 1>5>7>3, and the centre stays where it is
--   row turn     moves one row a slot along; the end wraps round, as a layer
--                turn would if the cube's four sides were all this face
--   column turn  the same for one column
-- Four quarter turns of any kind put every window back where it started.
--
-- The pure functions here are tested with plain Lua by
-- tools/check-cubeface.lua. Only register() touches Hyprland.

local M = {}

-- First free slot wins: centre, its right, then the 2x2 below, then the rest.
-- With n windows this gives: 1 full face, 2 side by side, 3 as two over one,
-- 4 as a 2x2 grid, 6 as a 2x3 grid and 9 as the full 3x3 face.
M.FILL = { 4, 5, 7, 8, 3, 6, 1, 0, 2 }

local function rc(s) return s // 3, s % 3 end
local function slot(r, c) return r * 3 + c end

-- A move maps every slot to the slot whose position its window takes.

-- dir 1 = clockwise, -1 = counter-clockwise
function M.face(dir)
  local m = {}
  for s = 0, 8 do
    local r, c = rc(s)
    if dir == 1 then m[s] = slot(c, 2 - r) else m[s] = slot(2 - c, r) end
  end
  return m
end

-- row r (0 top .. 2 bottom); dir 1 = right, -1 = left
function M.row(r, dir)
  local m = {}
  for s = 0, 8 do
    local sr, sc = rc(s)
    m[s] = (sr == r) and slot(sr, (sc + dir) % 3) or s
  end
  return m
end

-- column c (0 left .. 2 right); dir 1 = down, -1 = up
function M.column(c, dir)
  local m = {}
  for s = 0, 8 do
    local sr, sc = rc(s)
    m[s] = (sc == c) and slot((sr + dir) % 3, sc) or s
  end
  return m
end

-- New face after a move. slots: table indexed 0..8 of window ids (or nil).
function M.apply(slots, move)
  local out = {}
  for s = 0, 8 do
    if slots[s] ~= nil then out[move[s]] = slots[s] end
  end
  return out
end

-- Keep a face in step with the windows actually on its workspace: drop
-- windows that have gone, and give newcomers the first free FILL slots.
-- Returns the face and any windows beyond nine (in arrival order).
function M.sync(slots, ids)
  slots = slots or {}
  local present = {}
  for _, id in ipairs(ids) do present[id] = true end
  local placed = {}
  for s = 0, 8 do
    local id = slots[s]
    if id ~= nil then
      if present[id] then placed[id] = true else slots[s] = nil end
    end
  end
  local overflow = {}
  for _, id in ipairs(ids) do
    if not placed[id] then
      local free
      for _, s in ipairs(M.FILL) do
        if slots[s] == nil then free = s; break end
      end
      if free then
        slots[free] = id
        placed[id] = true
      else
        overflow[#overflow + 1] = id
      end
    end
  end
  return slots, overflow
end

local function round(x) return math.floor(x + 0.5) end

-- Boxes for a face inside area {x, y, w, h}: returns { [id] = box }.
-- Edges are rounded once and shared, so neighbouring boxes always meet
-- exactly. A face holds nine windows; any beyond that share the box of the
-- window in the last FILL slot, split side by side.
function M.boxes(slots, area, overflow)
  local hasRow, hasCol = {}, {}
  for s = 0, 8 do
    if slots[s] ~= nil then
      local r, c = rc(s)
      hasRow[r] = true
      hasCol[c] = true
    end
  end
  local R, C = {}, {}
  for i = 0, 2 do
    if hasRow[i] then R[#R + 1] = i end
    if hasCol[i] then C[#C + 1] = i end
  end
  local out = {}
  if #R == 0 then return out end
  local xs, ys = {}, {}
  for k = 0, #C do xs[k] = round(area.x + area.w * k / #C) end
  for k = 0, #R do ys[k] = round(area.y + area.h * k / #R) end
  for ri, r in ipairs(R) do
    -- which window covers each active column of this row
    local owner, last = {}, nil
    for k, c in ipairs(C) do
      local id = slots[slot(r, c)]
      if id ~= nil then last = id end
      owner[k] = last                     -- an empty slot joins the window on its left
    end
    local first
    for k = 1, #C do
      if owner[k] ~= nil then first = owner[k]; break end
    end
    for k = 1, #C do
      if owner[k] == nil then owner[k] = first end   -- ...or the row's first window
    end
    local k = 1
    while k <= #C do
      local id, k2 = owner[k], k
      while k2 < #C and owner[k2 + 1] == id do k2 = k2 + 1 end
      out[id] = { x = xs[k - 1], y = ys[ri - 1], w = xs[k2] - xs[k - 1], h = ys[ri] - ys[ri - 1] }
      k = k2 + 1
    end
  end
  if overflow and #overflow > 0 then
    local host = slots[M.FILL[#M.FILL]]
    local b = host and out[host]
    if b then
      local group = { host }
      for _, id in ipairs(overflow) do group[#group + 1] = id end
      for i, id in ipairs(group) do
        local x0 = round(b.x + b.w * (i - 1) / #group)
        local x1 = round(b.x + b.w * i / #group)
        out[id] = { x = x0, y = b.y, w = x1 - x0, h = b.h }
      end
    end
  end
  return out
end

-- Parse a layout message: "face cw", "face ccw", "row left|right",
-- "column up|down" (the row or column of the given slot). Returns a move.
function M.move_for(msg, focusSlot)
  local verb, arg = msg:match("^%s*(%a+)%s*(%a*)")
  if verb == "face" then
    if arg == "cw" then return M.face(1) end
    if arg == "ccw" then return M.face(-1) end
  elseif focusSlot ~= nil then
    local r, c = rc(focusSlot)
    if verb == "row" and arg == "right" then return M.row(r, 1) end
    if verb == "row" and arg == "left" then return M.row(r, -1) end
    if verb == "column" and arg == "down" then return M.column(c, 1) end
    if verb == "column" and arg == "up" then return M.column(c, -1) end
  end
  return nil
end

-- ---- Hyprland ------------------------------------------------------------------

M.faces = M.faces or {}            -- workspace id -> face (kept across reloads)

local function window_id(t)
  local w = t.window
  return (w and w.address) or ("target" .. tostring(t.index))
end

local function workspace_id(ctx)
  for _, t in ipairs(ctx.targets) do
    if t.window and t.window.workspace then return t.window.workspace.id end
  end
  return nil
end

local function place_all(ctx)
  local wsid = workspace_id(ctx)
  if wsid == nil then return end
  local ids, byId = {}, {}
  for _, t in ipairs(ctx.targets) do
    local id = window_id(t)
    ids[#ids + 1] = id
    byId[id] = t
  end
  local slots, overflow = M.sync(M.faces[wsid], ids)
  M.faces[wsid] = slots
  local boxes = M.boxes(slots, ctx.area, overflow)
  for id, box in pairs(boxes) do
    local t = byId[id]
    if t then t:place(box) end
  end
end

local function layout_msg(ctx, msg)
  local wsid = workspace_id(ctx)
  if wsid == nil then return false end
  local slots = M.faces[wsid] or {}
  local focus
  local active = hl.get_active_window and hl.get_active_window()
  if active then
    for s = 0, 8 do
      if slots[s] == active.address then focus = s end
    end
  end
  local move = M.move_for(msg, focus)
  if move == nil then return false end
  M.faces[wsid] = M.apply(slots, move)
  place_all(ctx)
  return true
end

M.recalculate = place_all
M.layout_msg = layout_msg

-- Hyprland names Lua layouts "lua:<name>", and a name can only be
-- registered once per session, while Omarchy re-runs the theme's Lua on
-- every config reload. So register thin wrappers once, and let each reload
-- point them at the newest copy of this module. Window places survive.
M.NAME = "lua:omacube"

function M.register(hl)
  local previous = rawget(_G, "__omacube_cubeface")
  if previous and previous ~= M and previous.faces then M.faces = previous.faces end
  _G.__omacube_cubeface = M
  if rawget(_G, "__omacube_cubeface_registered") then return end
  local ok = pcall(hl.layout.register, "omacube", {
    recalculate = function(ctx) return _G.__omacube_cubeface.recalculate(ctx) end,
    layout_msg = function(ctx, msg) return _G.__omacube_cubeface.layout_msg(ctx, msg) end,
  })
  -- ok is false when an earlier load in this session already registered it
  _G.__omacube_cubeface_registered = true
  return ok
end

return M
