# AnnotateLessAnalyseMore

A simple and lightweight browser-based annotation platform (tested on histopathology images). Designed for efficient polygon and freehand annotation of microscopy images, with direct export to semantic and instance segmentation masks.

Built with Flask + HTML5 Canvas. No installation wizard — just run one script.

Set the labels and colours for annotation task. This preset is based on PanNuke labels.
<img width="598" height="687" alt="image" src="https://github.com/user-attachments/assets/2cf1d1ab-8563-4398-96ca-b594c5e4f622" />

Work in local folder. Load and edit existing mask from any AI model. For instance segmentation, needs both instance and segmentation maps (using filename xxx_inst_map.png and xxx_sem_map.png)
<img width="2173" height="1162" alt="image" src="https://github.com/user-attachments/assets/7acd09c4-f0f1-4bff-a07b-a3700407657f" />

Load and edit existing mask from any AI model. For instance segmentation, needs both instance and segmentation maps. Try from TCGA samples in "sample" folder.
<img width="934" height="378" alt="image" src="https://github.com/user-attachments/assets/e63fe340-e743-4dc8-b37f-409bb7d1f789" />


---

## Option A — Standalone Executable (recommended)

Build once, then double-click the exe on any Windows machine. No Python required on the target.

```bat
build.bat
```

`build.bat` requires Python 3.9+ on the build machine only. It auto-creates a `venv/`, installs all deps including PyInstaller, and produces the exe.

### What you'll see after build.bat finishes

```
AnnotateLessAnalyseMore Installation_v2\
├── app.py
├── annotate.spec
├── build.bat
├── run.bat
├── run.sh
├── requirements.txt
├── README.md
├── UserManual.html
├── .gitignore
├── static\
│   ├── annotator.js
│   └── style.css
├── templates\
│   └── index.html
├── venv\              ← created by build.bat (Python environment, ~500 MB)
├── build\             ← created by build.bat (intermediate cache, safe to delete)
└── dist\
    └── AnnotateLessAnalyseMore.exe   ← the standalone executable (~80–120 MB)
```

### Deploying to another machine

1. Copy `dist\AnnotateLessAnalyseMore.exe` to any folder that contains your image files
2. Double-click `AnnotateLessAnalyseMore.exe`
3. Your browser opens automatically at `http://127.0.0.1:5000`
4. A terminal window shows the server URL and logs — close it to stop the server

> **First launch takes 3–5 seconds** while the exe unpacks its bundled Python environment.
> No installation required on the target machine.

---

## Option B — Run from Source

### Windows

```bat
run.bat
```

### macOS / Linux

```bash
chmod +x run.sh
./run.sh
```

Both scripts will:
1. Create a Python virtual environment (`venv/`) on first run
2. Install all dependencies from `requirements.txt`
3. Launch the Flask server
4. Print the URL — open `http://127.0.0.1:5000` in your browser

---

## Requirements

- Python 3.9 or newer
- A modern browser (Chrome / Edge / Firefox)
- (Optional) A stylus / pen input device for freehand annotation

---

## Manual Setup

If you prefer to manage the environment yourself:

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
python app.py
```

---

## Project Structure

```
app.py                  Flask backend (API + file serving)
requirements.txt        Python dependencies
templates/index.html    UI shell
static/style.css        Theming (dark + light mode via CSS custom properties)
static/annotator.js     Canvas annotation engine

annotations/            Auto-created — per-image annotation JSON files
```

Image files (`.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`) placed in the project root
are automatically discovered and listed in the sidebar.

---

## Annotation Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| Draw (polygon) | `D` | Click to place vertices; right-click or double-click to close |
| Freehand | `H` | Click-drag to draw freely; RDP simplification applied on release |
| Edit | `E` | Click to select; drag vertices; click edge to insert vertex |
| Pan | `P` / hold `Space` | Pan the canvas |

### Stylus / Pen

- All tools use the Pointer Events API — stylus pressure and `touch-action:none` are handled automatically
- In freehand mode the stylus stroke is captured end-to-end with `setPointerCapture`
- In edit mode, pressing the **barrel button** and dragging starts a freehand stroke; the tool returns to edit and auto-selects the new annotation on release
- Single-finger touch always pans regardless of active tool

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `D` | Polygon draw |
| `H` | Freehand draw |
| `E` | Edit |
| `P` / `Space` | Pan (hold) |
| `F` | Fit image to view |
| `Scroll` | Pan |
| `Ctrl + Scroll` / Pinch | Zoom |
| `Del` / `Backspace` | Delete selected annotations |
| `↑` / `↓` | Navigate annotation list |
| `Esc` | Cancel drawing / freehand stroke |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |
| `Ctrl + S` | Save |
| Right-click | Remove last polygon point / cancel freehand |

---

## Export

### PNG Masks

Click **Export PNG** to write two files alongside the source image:

| File | Format | Description |
|------|--------|-------------|
| `<stem>_sem_map.png` | uint8 | Semantic mask — pixel value = class index (0–5, CoNSeP convention) |
| `<stem>_inst_map.png` | uint16 | Instance mask — pixel value = instance ID (1…N), background = 0 |

`<stem>` is the image filename without its extension (e.g. `slide01.jpg` → `slide01_sem_map.png`).

### GeoJSON

Click **Export GeoJSON** to write a QuPath-compatible `FeatureCollection` with
`classification.name` and `[R, G, B]` color array per annotation (QuPath 0.4+ format).

---

## Label Schema (Default)

Matches the CoNSeP / PanNuke nuclear classification convention:

| Index | Label | Color |
|:-----:|-------|-------|
| 0 | Background | `#ffffff` |
| 1 | Neoplastic | `#ff0000` |
| 2 | Inflammatory | `#0000ff` |
| 3 | Connective | `#00ff00` |
| 4 | Dead | `#808080` |
| 5 | Epithelial | `#ffff00` |

Labels are configurable via the **⚙ Labels** button. Custom label sets are saved in `localStorage` and restored on next visit.

---

## Load Mask

Click **⬇ Load Mask** to import an existing mask back as editable annotations:

- **Semantic map** (`_sem_map.png`) — pixel values 1–5 are mapped to CoNSeP labels
- **Instance + semantic pair** — when an `_inst_map.png` is selected and a matching `_sem_map.png` exists, each instance is labelled from the semantic mask (mode class per instance)
- **Instance only** — no paired semantic mask → single fallback label for all instances

Filename suffixes (`_inst_map` / `_sem_map`) take priority over the pixel-value heuristic, so small annotation counts are never misidentified.

---

# Sample Images — TCGA-BA-5558

Six H&E patches from the TCGA-BA-5558-01Z-00-DX1 whole-slide image, extracted at
scales 0–5. Each scale corresponds to a different field of view / zoom level.

## Files per scale

| Scale | Source image | Semantic mask | Instance mask | GeoJSON |
|:-----:|--------------|---------------|---------------|---------|
| 0 | `0-TCGA-BA-5558-01Z-00-DX1_0_7_520.jpg` | `…_sem_map.png` | `…_inst_map.png` | `….geojson` |
| 1 | `1-TCGA-BA-5558-01Z-00-DX1_0_2_624.jpg` | `…_sem_map.png` | `…_inst_map.png` | `….geojson` |
| 2 | `2-TCGA-BA-5558-01Z-00-DX1_0_1_728.jpg` | `…_sem_map.png` | `…_inst_map.png` | `….geojson` |
| 3 | `3-TCGA-BA-5558-01Z-00-DX1_0_3_832.jpg` | `…_sem_map.png` | `…_inst_map.png` | `….geojson` |
| 4 | `4-TCGA-BA-5558-01Z-00-DX1_0_3_936.jpg` | `…_sem_map.png` | `…_inst_map.png` | `….geojson` |
| 5 | `5-TCGA-BA-5558-01Z-00-DX1_0_5_1041.jpg` | `…_sem_map.png` | `…_inst_map.png` | `….geojson` |

## Label schema (CoNSeP / PanNuke convention)

| Pixel value | Class |
|:-----------:|-------|
| 0 | Background |
| 1 | Neoplastic |
| 2 | Inflammatory |
| 3 | Connective |
| 4 | Dead |
| 5 | Epithelial |

## How to use with AnnotateLessAnalyseMore

1. Copy the `.jpg` files (and optionally the `_sem_map.png` / `_inst_map.png` files) into the
   same folder as `AnnotateLessAnalyseMore.exe` (or `app.py` when running from source).
2. Launch the app — the images will appear in the sidebar automatically.
3. To load existing masks, click **⬇ Load Mask** and select the corresponding `_inst_map.png`.

The `.geojson` files can be imported into QuPath for cross-validation.

---

## Dark / Light Mode

The **Light Mode / Dark Mode** button in the title bar toggles the theme. The preference is persisted in `localStorage` and restored on next visit.

---

## License

Research use. 
