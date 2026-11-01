-- Omacube: sticker-colour borders and "layer click" motion.
-- Turns snap like a cube layer: a fast flick, a small overshoot, a settle.

hl.curve("cubeClick", { type = "bezier", points = { { 0.22, 1.35 }, { 0.36, 1 } } })
hl.curve("cubeFlick", { type = "bezier", points = { { 0.3, 0 }, { 0.15, 1 } } })

hl.config({
  general = {
    col = {
      -- gradients must be Lua tables, not "rgba() rgba() 45deg" strings
      active_border = { colors = { "rgb(ffd500)", "rgb(ff6a1a)", "rgb(e0304a)", "rgb(2e6fe0)", "rgb(00b86b)" }, angle = 45 },
      inactive_border = "rgba(17181caa)",
    },
  },
  decoration = {
    rounding = 6,
  },
  group = {
    col = {
      border_active = "rgb(ffd500)",
    },
  },
})

-- windows pop in like a cubie clicking into place
hl.animation({ leaf = "windowsIn", enabled = true, speed = 3.6, bezier = "cubeClick", style = "popin 70%" })
hl.animation({ leaf = "windowsMove", enabled = true, speed = 3.2, bezier = "cubeClick", style = "slide" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 1.6, bezier = "cubeFlick", style = "popin 70%" })
-- workspaces turn sideways like a layer; the Omacube plugin twists the background with them
hl.animation({ leaf = "workspaces", enabled = true, speed = 4.2, bezier = "cubeClick", style = "slide" })
hl.animation({ leaf = "specialWorkspace", enabled = true, speed = 3.6, bezier = "cubeClick", style = "slidevert" })
-- keep borderangle off: an animated gradient redraws at full rate forever
hl.animation({ leaf = "borderangle", enabled = false })
