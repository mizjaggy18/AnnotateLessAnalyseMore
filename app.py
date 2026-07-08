import os, sys, json, threading, webbrowser
import numpy as np
import cv2
from PIL import Image, ImageDraw
from flask import Flask, jsonify, request, send_from_directory, render_template

# ── Frozen-path handling (PyInstaller exe vs. plain python app.py) ─────────
if getattr(sys, 'frozen', False):
    BUNDLE_DIR = sys._MEIPASS                     # bundled assets in temp dir (read-only)
    APP_DIR    = os.path.dirname(sys.executable)  # exe location — writable, persistent
else:
    BUNDLE_DIR = os.path.dirname(os.path.abspath(__file__))
    APP_DIR    = BUNDLE_DIR

BASE_DIR = APP_DIR
ANN_DIR  = os.path.join(APP_DIR, 'annotations')
os.makedirs(ANN_DIR, exist_ok=True)

app = Flask(__name__,
            template_folder=os.path.join(BUNDLE_DIR, 'templates'),
            static_folder=os.path.join(BUNDLE_DIR, 'static'))

REGION_LABELS = {
    0: "Background", 1: "Neoplastic", 2: "Inflammatory",
    3: "Connective", 4: "Dead", 5: "Epithelial"
}
REGION_COLORS = {
    0: (255, 255, 255), 1: (255, 0, 0), 2: (0, 0, 255),
    3: (0, 255, 0),     4: (128, 128, 128), 5: (255, 255, 0)
}
# Reverse map: label name → class index
LABEL_TO_IDX = {v: k for k, v in REGION_LABELS.items()}

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.tif', '.tiff'}

def is_mask_file(name):
    n = name.lower()
    return '_inst_map' in n or '_sem_map' in n or n.startswith('mask_')

def list_images():
    imgs = []
    for f in sorted(os.listdir(BASE_DIR)):
        ext = os.path.splitext(f)[1].lower()
        if ext in IMAGE_EXTS and not is_mask_file(f):
            imgs.append(f)
    return imgs

def list_masks():
    masks = []
    for f in sorted(os.listdir(BASE_DIR)):
        ext = os.path.splitext(f)[1].lower()
        if ext in IMAGE_EXTS and is_mask_file(f):
            masks.append(f)
    return masks

def find_paired_mask(mask_name):
    """Given an inst_map or sem_map filename, return the counterpart path if it exists."""
    base = os.path.splitext(mask_name)[0]
    if '_inst_map' in base:
        candidate = base.replace('_inst_map', '_sem_map') + '.png'
    elif '_sem_map' in base:
        candidate = base.replace('_sem_map', '_inst_map') + '.png'
    else:
        return None
    return candidate if os.path.exists(os.path.join(BASE_DIR, candidate)) else None

def guess_mask(image_name):
    """Try to find a matching mask file for an image."""
    base = os.path.splitext(image_name)[0]
    candidates = [
        base + '_inst_map.png',
        base.replace('image_', 'mask_') + '.png',
        'mask_' + base + '.png',
    ]
    for c in candidates:
        if os.path.exists(os.path.join(BASE_DIR, c)):
            return c
    return None

def _read_mask_gray(mask_path):
    mask = cv2.imread(mask_path, cv2.IMREAD_UNCHANGED)
    if mask is None:
        return None
    if mask.ndim == 3:
        mask = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)
    return mask

def _binary_to_polys(binary, max_polys=300, min_area=20, epsilon_factor=0.008):
    """Convert a uint8 binary mask to simplified polygon point lists."""
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    for cnt in contours:
        if len(polys) >= max_polys:
            break
        if cv2.contourArea(cnt) < min_area:
            continue
        eps = epsilon_factor * cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, eps, True)
        pts = approx.reshape(-1, 2).tolist()
        if len(pts) >= 3:
            polys.append(pts)
    return polys

def _instance_with_semantic(inst_path, sem_path, assignments, max_polys=200, min_area=20, epsilon_factor=0.008):
    """Build per-instance labeled polygons; class for each instance taken from paired semantic mask."""
    inst = cv2.imread(inst_path, cv2.IMREAD_UNCHANGED)
    if inst is None:
        return []
    if inst.ndim == 3:
        inst = inst[:, :, 0]

    sem = _read_mask_gray(sem_path)
    if sem is None:
        return []

    minlen = max(REGION_LABELS.keys()) + 1
    pv_to_label = {
        int(a['pixel_value']): (a['label'], a.get('color', '#999999'))
        for a in assignments
        if a.get('pixel_value') is not None
    }

    result = []
    for iid in np.unique(inst):
        if iid == 0 or len(result) >= max_polys:
            continue
        pix_mask = inst == iid
        counts = np.bincount(sem[pix_mask].astype(np.int64), minlength=minlen)
        counts[0] = 0  # ignore background class
        if counts.max() == 0:
            continue
        cls = int(np.argmax(counts))
        if cls not in pv_to_label:
            continue
        label, color = pv_to_label[cls]
        binary = (pix_mask.astype(np.uint8)) * 255
        remaining = max_polys - len(result)
        for pts in _binary_to_polys(binary, remaining, min_area, epsilon_factor):
            result.append({'label': label, 'color': color, 'points': pts})
            if len(result) >= max_polys:
                break
    return result

def mask_to_polygons(mask_path, max_polys=300, min_area=20, epsilon_factor=0.008):
    mask = _read_mask_gray(mask_path)
    if mask is None:
        return []
    unique_vals = np.unique(mask)
    unique_vals = unique_vals[unique_vals > 0]
    polygons = []
    for val in unique_vals[:max_polys]:
        binary = ((mask == val).astype(np.uint8)) * 255
        for pts in _binary_to_polys(binary, max_polys - len(polygons), min_area, epsilon_factor):
            polygons.append({'points': pts, 'instance_id': int(val)})
    return polygons

def _is_class_map(unique_vals):
    """True when all non-zero pixel values match a REGION_LABELS key."""
    return len(unique_vals) > 0 and all(int(v) in REGION_LABELS for v in unique_vals)

def hex_to_rgb_list(hex_color):
    """Convert #RRGGBB to [R, G, B] list — QuPath 0.4+ color array format."""
    return [int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16)]

# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/images')
def api_images():
    return jsonify(list_images())

@app.route('/api/masks')
def api_masks():
    return jsonify(list_masks())

@app.route('/api/guess-mask/<path:image_name>')
def api_guess_mask(image_name):
    m = guess_mask(image_name)
    return jsonify({'mask': m})

@app.route('/img/<path:filename>')
def serve_image(filename):
    return send_from_directory(BASE_DIR, filename)

@app.route('/api/mask-polygons/<path:mask_name>')
def api_mask_polygons(mask_name):
    path = os.path.join(BASE_DIR, mask_name)
    if not os.path.isfile(path):
        return jsonify({'error': 'not found'}), 404
    polys = mask_to_polygons(path)
    return jsonify(polys)

@app.route('/api/mask-analysis/<path:mask_name>')
def api_mask_analysis(mask_name):
    """Return unique pixel groups + auto-suggested labels without building polygons."""
    path = os.path.join(BASE_DIR, mask_name)
    if not os.path.isfile(path):
        return jsonify({'error': 'not found'}), 404

    mask = _read_mask_gray(path)
    if mask is None:
        return jsonify({'error': 'cannot read mask'}), 400

    unique_vals = [int(v) for v in np.unique(mask) if v > 0]

    # Filename is the most reliable type hint; pixel-value heuristic is a fallback only
    _nl = mask_name.lower()
    if '_inst_map' in _nl:
        class_map = False
    elif '_sem_map' in _nl:
        class_map = True
    else:
        class_map = _is_class_map(unique_vals)

    paired = find_paired_mask(mask_name)
    groups = []

    if class_map:
        for val in unique_vals:
            binary = (mask == val).astype(np.uint8)
            n, _ = cv2.connectedComponents(binary)
            r, g, b = REGION_COLORS.get(val, (128, 128, 128))
            groups.append({
                'pixel_value': val,
                'count': max(0, n - 1),
                'suggested_label': REGION_LABELS.get(val, f'Class {val}'),
                'color': f'#{r:02x}{g:02x}{b:02x}',
            })
        return jsonify({'is_class_map': True, 'paired_mask': paired, 'groups': groups})

    # Instance map: check for paired semantic mask
    paired_sem = paired if (paired and '_sem_map' in paired) else None
    if paired_sem:
        sem = _read_mask_gray(os.path.join(BASE_DIR, paired_sem))
        if sem is not None:
            minlen = max(REGION_LABELS.keys()) + 1
            class_counts = {}
            for iid in unique_vals:
                pix_mask = mask == iid
                counts = np.bincount(sem[pix_mask].astype(np.int64), minlength=minlen)
                counts[0] = 0
                if counts.max() == 0:
                    continue
                cls = int(np.argmax(counts))
                class_counts[cls] = class_counts.get(cls, 0) + 1
            for cls in sorted(class_counts):
                r, g, b = REGION_COLORS.get(cls, (128, 128, 128))
                groups.append({
                    'pixel_value': cls,
                    'count': class_counts[cls],
                    'suggested_label': REGION_LABELS.get(cls, f'Class {cls}'),
                    'color': f'#{r:02x}{g:02x}{b:02x}',
                })
            return jsonify({'is_class_map': False, 'has_paired_sem': paired_sem, 'groups': groups})

    # Instance map, no paired semantic
    total = 0
    for val in unique_vals:
        binary = (mask == val).astype(np.uint8)
        n, _ = cv2.connectedComponents(binary)
        total += max(0, n - 1)
    groups.append({'pixel_value': None, 'count': total, 'suggested_label': None, 'color': None})
    return jsonify({'is_class_map': False, 'has_paired_sem': None, 'groups': groups})

@app.route('/api/mask-import', methods=['POST'])
def api_mask_import():
    """Build and return labeled polygons from a mask given confirmed assignments."""
    data          = request.get_json()
    mask_name     = data.get('mask_name', '')
    sem_mask_name = data.get('sem_mask_name', '')   # paired semantic mask (optional)
    assignments   = data.get('assignments', [])     # [{pixel_value: int|null, label, color}]
    max_polys     = int(data.get('max_polys', 200))

    path = os.path.join(BASE_DIR, mask_name)
    if not os.path.isfile(path):
        return jsonify({'error': 'not found'}), 404

    # Instance map + paired semantic mask → per-instance label assignment
    if sem_mask_name:
        sem_path = os.path.join(BASE_DIR, sem_mask_name)
        if os.path.isfile(sem_path):
            return jsonify(_instance_with_semantic(path, sem_path, assignments, max_polys))

    mask = _read_mask_gray(path)
    if mask is None:
        return jsonify({'error': 'cannot read mask'}), 400

    result = []
    is_class = any(a.get('pixel_value') is not None for a in assignments)

    if is_class:
        for a in assignments:
            pv    = int(a['pixel_value'])
            label = a['label']
            color = a.get('color', '#999999')
            binary = ((mask == pv).astype(np.uint8)) * 255
            remaining = max_polys - len(result)
            if remaining <= 0:
                break
            for pts in _binary_to_polys(binary, remaining):
                result.append({'label': label, 'color': color, 'points': pts})
    else:
        # Instance map: every unique value → same label
        a     = assignments[0] if assignments else {}
        label = a.get('label', 'Unknown')
        color = a.get('color', '#999999')
        unique_vals = [int(v) for v in np.unique(mask) if v > 0]
        for val in unique_vals:
            if len(result) >= max_polys:
                break
            binary = ((mask == val).astype(np.uint8)) * 255
            remaining = max_polys - len(result)
            for pts in _binary_to_polys(binary, remaining):
                result.append({'label': label, 'color': color, 'points': pts})
                if len(result) >= max_polys:
                    break

    return jsonify(result)

@app.route('/api/annotations/<path:image_name>', methods=['GET'])
def get_annotations(image_name):
    f = os.path.join(ANN_DIR, image_name + '.json')
    if os.path.isfile(f):
        with open(f) as fp:
            return jsonify(json.load(fp))
    return jsonify([])

@app.route('/api/annotations/<path:image_name>', methods=['POST'])
def save_annotations(image_name):
    data = request.get_json()
    f = os.path.join(ANN_DIR, image_name + '.json')
    with open(f, 'w') as fp:
        json.dump(data, fp)
    return jsonify({'status': 'ok', 'count': len(data)})

@app.route('/api/export/png/<path:image_name>')
def export_png(image_name):
    ann_file = os.path.join(ANN_DIR, image_name + '.json')
    if not os.path.isfile(ann_file):
        return jsonify({'error': 'no annotations saved'}), 404

    img_path = os.path.join(BASE_DIR, image_name)
    with Image.open(img_path) as src:
        w, h = src.size

    with open(ann_file) as fp:
        anns = json.load(fp)

    next_idx = max(REGION_LABELS.keys()) + 1
    label_map = {}

    # ── Semantic mask (uint8, pixel = class index 0–5) ────────────
    sem_img = Image.new('L', (w, h), 0)
    sem_draw = ImageDraw.Draw(sem_img)

    # ── Instance mask (uint16, pixel = sequential instance ID) ────
    inst_arr = np.zeros((h, w), dtype=np.uint16)

    for inst_id, ann in enumerate(anns, start=1):
        label = ann.get('label', 'unknown')
        if label not in label_map:
            label_map[label] = LABEL_TO_IDX.get(label, next_idx)
            if label not in LABEL_TO_IDX:
                next_idx += 1
        pts = [tuple(p) for p in ann['points']]
        if len(pts) < 3:
            continue
        # Semantic: fill class index
        sem_draw.polygon(pts, fill=label_map[label])
        # Instance: fill sequential ID via cv2 (supports uint16)
        cv2_pts = np.array(pts, dtype=np.int32).reshape((-1, 1, 2))
        cv2.fillPoly(inst_arr, [cv2_pts], color=inst_id)

    base = os.path.splitext(image_name)[0]

    sem_name = base + '_sem_map.png'
    sem_img.save(os.path.join(BASE_DIR, sem_name))

    inst_name = base + '_inst_map.png'
    cv2.imwrite(os.path.join(BASE_DIR, inst_name), inst_arr)

    return jsonify({
        'status': 'ok',
        'sem_file': sem_name,
        'inst_file': inst_name,
        'label_map': label_map,
    })

@app.route('/api/export/geojson/<path:image_name>')
def export_geojson(image_name):
    ann_file = os.path.join(ANN_DIR, image_name + '.json')
    if not os.path.isfile(ann_file):
        return jsonify({'error': 'no annotations saved'}), 404

    with open(ann_file) as fp:
        anns = json.load(fp)

    label_colors = {}
    features = []

    def _qupath_color_for(label, fallback_hex):
        idx = LABEL_TO_IDX.get(label)
        if idx is not None and idx in REGION_COLORS:
            return list(REGION_COLORS[idx])   # [R, G, B]
        return hex_to_rgb_list(fallback_hex)

    for ann in anns:
        label = ann.get('label', 'Annotation')
        color_hex = ann.get('color', '#e74c3c')
        if label not in label_colors:
            label_colors[label] = _qupath_color_for(label, color_hex)

        pts = ann['points']
        coords = [[p[0], p[1]] for p in pts]
        if coords and coords[0] != coords[-1]:
            coords.append(coords[0])

        features.append({
            "type": "Feature",
            "id": "PathAnnotationObject",
            "geometry": {
                "type": "Polygon",
                "coordinates": [coords]
            },
            "properties": {
                "objectType": "annotation",
                "classification": {
                    "name": label,
                    "color": label_colors[label]
                },
                "isLocked": False,
                "measurements": []
            }
        })

    geojson = {"type": "FeatureCollection", "features": features}
    out_name = os.path.splitext(image_name)[0] + '.geojson'
    out_path = os.path.join(BASE_DIR, out_name)
    with open(out_path, 'w') as fp:
        json.dump(geojson, fp, indent=2)
    return jsonify({'status': 'ok', 'file': out_name})

if __name__ == '__main__':
    import socket

    def _find_port(start=5000, end=5010):
        for p in range(start, end):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                if s.connect_ex(('127.0.0.1', p)) != 0:
                    return p
        return start

    port   = _find_port()
    frozen = getattr(sys, 'frozen', False)

    if frozen:
        import time
        def _open_browser():
            time.sleep(2.0)
            webbrowser.open(f'http://127.0.0.1:{port}')
        threading.Thread(target=_open_browser, daemon=True).start()

    print(f'AnnotateLessAnalyseMore  →  http://127.0.0.1:{port}')
    print(f'Images / data directory  →  {APP_DIR}')
    app.run(debug=not frozen, port=port, use_reloader=False)
