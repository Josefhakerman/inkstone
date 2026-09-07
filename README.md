# InkStone

An offline Windows app for writing notes and ideas on unlimited black canvases,
organised into folders. Monochrome, square-cornered, heavy-ruled.

Nothing leaves your machine: there is no network code in the app at all, and the
renderer's content-security policy blocks outbound connections outright.

## Run it

**Installed** — run `dist/InkStone-1.0.0-setup.exe`. You can pick the install
folder; it adds a Start Menu entry and a desktop shortcut.

**Portable** — run `dist/InkStone-1.0.0-portable.exe`. No install, no admin.

Your notes live in `%APPDATA%\InkStone\data`, not next to the exe, so both
builds share the same library. The **Storage folder** button at the bottom of
the sidebar opens it.

If you used the earlier NoteApp build, InkStone copies that library across the
first time it starts. The old folder is left untouched as a backup.

## The workspace

Black, and unbounded in every direction. A small crosshair marks the origin so
**Center** always means something.

- **Pan** — space + drag, middle-mouse drag, the hand tool, or the scroll wheel
  (shift + wheel moves sideways)
- **Zoom** — ctrl + wheel, or the controls at the bottom left
- **Fit** — frames everything on the board, or just the selection if you have one

### Paper

Each workspace carries its own background, so a sketchbook and a planner can
look different. The **Paper** button in the status bar switches between dots,
grid, graph (a heavier rule every fifth line), ruled lines, columns, and plain,
with four spacings. `G` cycles through them. The choice is saved with the
workspace, not globally.

Spacing doubles and halves itself as you zoom so the pattern never turns to
mush, and fades out rather than crawling when the lines get too dense.

## Tools

The toolbar sits centred on the left edge; the properties bar for the current
tool sits centred on the top edge.

| | Tool | Key |
|---|---|---|
| ↖ | Select and move | `V` |
| ✋ | Pan | `H` |
| ✏ | Draw, thickness 1–40 | `P` |
| 🖊 | Highlighter, thickness 6–90, translucent | `M` |
| ◇ | Eraser | `E` |
| ▭ | Shapes — rectangle, ellipse, diamond, line, arrow | `R` |
| 🪣 | Fill a shape | `F` |
| T | Text box | `T` |
| ☑ | Checklist | `K` |
| 🖼 | Image | `I` |
| 🔗 | Link to another workspace | `L` |

### Eraser

Two modes, switched in the properties bar:

- **Partial** (default) rubs out only the part of a stroke you actually cross.
  The stroke is split around the eraser's path and the surviving pieces stay as
  independent strokes. Long straight segments are walked in small steps, so it
  bites mid-segment rather than only near recorded points, and the cut follows
  the whole path the cursor swept that frame — a fast drag still cuts cleanly
  instead of leaving gaps between mouse samples.
- **Whole** removes any stroke you touch outright, the original behaviour.

Shapes are not polylines, so both modes remove them whole.

### Everything else

Shapes take a line colour, a line width, and an infill colour (or none). The
fill tool recolours the inside of any shape you click. Hold shift while drawing
for a perfect square or circle, or to snap a line to 45°.

**Checklists** are live: tick items off, press Enter for the next one,
backspace on an empty line to remove it, drag the grip to reorder.

**Images** come from the image tool, ctrl+V, or dragging files onto the canvas.
Large ones are downscaled to 1800px on the long edge so note files stay small.

**Workspace links** are cards that jump to another board on double-click. If the
target is deleted the card says so rather than failing silently.

## Sidebar

A file tree of folders and workspaces. Create either with the buttons at the
top, rename by double-clicking or `F2`, and drag rows to reorganise — drop onto
the middle of a folder to move inside it, or near the edge of a row to reorder.
Search filters the tree and opens folders to show matches.

## Selection

Click to select, shift-click to add, or drag on empty canvas to rubber-band. A
single selected item gets resize handles — text boxes, checklists and links
resize by width only, since their height follows their content. Images keep
their aspect ratio unless you hold alt.

The properties bar retargets to whatever is selected, so you can recolour,
resize or restack after the fact. `[` and `]` send to back and bring to front.

## Saving

Everything autosaves about half a second after you stop, and again on window
blur; closing the window waits for the last write to land. Writes go through a
temp file and a rename, so a crash mid-save can't corrupt a board. Each
workspace is a plain JSON file in `%APPDATA%\InkStone\data\workspaces`.

Undo (`Ctrl+Z`) and redo (`Ctrl+Y`) hold the last 80 steps of the open board.

**Export PNG** renders the whole board — strokes, shapes, images, text,
checklists and link cards — to a single image at 2× scale.

Press `?` in the app for the full shortcut list.

## Look

The interface is monochrome by design: black grounds, white ink, grey rules, no
gradients, no rounded corners anywhere, 2px borders throughout. The one place
colour survives is the drawing palette, because that is your ink rather than
chrome — the defaults are all white, so a board stays monochrome unless you
choose otherwise.

## Building from source

```bash
npm install
npm start          # run from source
npm run dist       # build the installer and portable exe into dist/
```

Requires Node 18+. `npm install` needs to fetch the Electron binary once; after
that the app itself never touches the network.

To run against a throwaway library instead of your real notes, pass
`--user-data-dir` to Electron.

### One Windows quirk

`electron-builder` ships its code-signing tools in an archive containing macOS
symlinks, which Windows refuses to unpack unless Developer Mode is on. The build
config sets `win.signAndEditExecutable: false` to skip that download, and
`build/after-pack.js` stamps the icon and version info onto the exe with a
cached copy of `rcedit` instead. Turn Developer Mode on and you can drop both
and let electron-builder do it the usual way.

## Layout

```
main.js              Electron main process: window, storage IPC, file dialogs
preload.js           The narrow API bridge exposed to the renderer
src/util.js          ids, geometry, icons, modal/menu/toast
src/store.js         The folder tree and its persistence
src/tree.js          Sidebar rendering, drag-and-drop, rename, search
src/workspace.js     The open board: items, camera, paper, undo history, autosave
src/render.js        Canvas drawing, camera maths, backgrounds, PNG export
src/elements.js      DOM-backed items: text boxes, checklists, link cards
src/tools.js         Tools, toolbar, properties bar, selection, pointer input
src/app.js           Bootstrap and the glue between all of the above
build/after-pack.js  Post-package icon/version stamping
build/icon-source.png  Artwork the .ico is generated from
```

Strokes, shapes and images are drawn on a canvas in world coordinates; text,
checklists and links are real DOM elements positioned by the same camera, so
they stay editable and selectable. The PNG exporter draws both kinds onto one
offscreen canvas.
