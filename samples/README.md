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
