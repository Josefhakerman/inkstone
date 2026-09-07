# NoteApp

An offline Windows app for writing notes and ideas on unlimited dark canvases,
organised into folders. Microsoft Paint × Google Keep.

Nothing leaves your machine: there is no network code in the app at all, and the
renderer's content-security policy blocks outbound connections outright.

## Run it

**Installed** — run `dist/NoteApp Setup 1.0.0.exe`. You can pick the install
folder; it adds a Start Menu entry and a desktop shortcut.

**Portable** — run `dist/NoteApp-1.0.0-portable.exe`. No install, no admin.

Either way your notes live in `%APPDATA%\NoteApp\data`, not next to the exe, so
both builds share the same library. The **Storage folder** button at the bottom
of the sidebar opens that folder.

## The workspace

Black, and unbounded in every direction. A faint dot grid that rescales with
zoom gives you a sense of place, and a small crosshair marks the origin so
**Center** always means something.

- **Pan** — space + drag, middle-mouse drag, the hand tool, or the scroll wheel
  (shift + wheel moves sideways)
- **Zoom** — ctrl + wheel, or the controls at the bottom left
- **Fit** — frames everything on the board, or just the selection if you have one

## Tools

| | Tool | Key |
|---|---|---|
| ↖ | Select and move | `V` |
| ✋ | Pan | `H` |
| ✏ | Draw, thickness 1–40 | `P` |
| 🖊 | Highlighter, thickness 6–90, translucent | `M` |
| ◇ | Eraser, adjustable radius | `E` |
| ▭ | Shapes — rectangle, ellipse, diamond, line, arrow | `R` |
| 🪣 | Fill a shape | `F` |
| T | Text box | `T` |
| ☑ | Checklist | `K` |
| 🖼 | Image | `I` |
| 🔗 | Link to another workspace | `L` |

Shapes take a line colour, a line width, and an infill colour (or none). The
fill tool recolours the inside of any shape you click; pick **Remove fill** in
the properties bar to clear it again. Hold shift while drawing a shape for a
perfect square or circle, or to snap a line to 45°.

**Checklists** are live: tick items off, press Enter for the next one,
backspace on an empty line to remove it, and drag the grip to reorder. A
progress bar tracks how far along you are.

**Images** come in three ways — the image tool, ctrl+V from the clipboard, or
dragging files onto the canvas. Large images are downscaled to 1800px on the
long edge so note files stay small.

**Workspace links** are cards that jump to another board when you double-click
them, so you can wire your boards together. If a link's target is deleted the
card says so rather than failing silently.

## Sidebar

A file tree of folders and workspaces. Create either with the buttons at the
top, rename by double-clicking or `F2`, and drag rows to reorganise — drop onto
the middle of a folder to move inside it, or near the edge of a row to reorder.
Search filters the tree and opens folders to show matches.

Right-click a workspace to duplicate it, drop a link to it onto the board you're
on, or delete it.

## Selection

Click to select, shift-click to add, or drag on empty canvas to rubber-band. A
single selected item gets resize handles — text boxes, checklists and links
resize by width only, since their height follows their content. Images keep
their aspect ratio unless you hold alt.

The properties bar retargets to whatever is selected, so you can recolour, resize
or restack after the fact. `[` and `]` send to back and bring to front.

## Saving

Everything autosaves about half a second after you stop, and again on window
blur; closing the window waits for the last write to land. Writes go through a
temp file and a rename, so a crash mid-save can't corrupt a board. Each
workspace is a plain JSON file in `%APPDATA%\NoteApp\data\workspaces`.

Undo (`Ctrl+Z`) and redo (`Ctrl+Y`) hold the last 80 steps of the open board.

**Export PNG** renders the whole board — strokes, shapes, images, text,
checklists and link cards — to a single image at 2× scale.

Press `?` in the app for the full shortcut list.

## Building from source

```bash
npm install
npm start          # run from source
npm run dist       # build the installer and portable exe into dist/
```

Requires Node 18+. `npm install` needs to fetch the Electron binary once; after
that the app itself never touches the network.

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
src/workspace.js     The open board: items, camera, undo history, autosave
src/render.js        Canvas drawing, camera maths, dot grid, PNG export
src/elements.js      DOM-backed items: text boxes, checklists, link cards
src/tools.js         Tools, toolbar, properties bar, selection, pointer input
src/app.js           Bootstrap and the glue between all of the above
build/after-pack.js  Post-package icon/version stamping
```

Strokes, shapes and images are drawn on a canvas in world coordinates; text,
checklists and links are real DOM elements positioned by the same camera, so
they stay editable and selectable. The PNG exporter draws both kinds onto one
offscreen canvas.
