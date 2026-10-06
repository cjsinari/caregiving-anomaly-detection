# Data Directory

Raw and large processed datasets are not committed to this repository due to size.

## How to obtain the data

1. Download the RBA dataset from Kaggle:
   https://www.kaggle.com/datasets/dasgroup/rba-dataset
   Place as `rba-dataset.csv` in this folder.

2. Run `notebooks/01_rba_exploration.ipynb` to generate `rba_sample.csv`

3. Run `notebooks/02_feature_engineering.ipynb` to generate:
   - `checkpoint_all_features.parquet`
   - `rba_features_v2.parquet`

4. Run `notebooks/04_synthetic_anomaly_injection.ipynb` to generate:
   - `synthetic_anomaly_dataset.parquet` (also committed directly — see /data/synthetic_anomaly_dataset.parquet)

## Trained models

Trained models and metadata are committed directly in `../models/`:
- `isolation_forest_synthetic.pkl` — final Isolation Forest (max_features=0.5)
- `scaler_synthetic.pkl` — StandardScaler fitted on training data
- `model_metadata_synthetic.json` — training config, evaluation metrics, model comparison results

All intermediate large files are also backed up in Google Drive:
`mzazicare-ml/data/` and `mzazicare-ml/models/` (access available on request)