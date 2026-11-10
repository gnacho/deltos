# Screenshots

Regenerates the images used by the README (`assets/`) and the landing
(`landing/assets/`): eight screens in Spanish and English, light and dark.

Everything runs against a throwaway instance on a temporary database, seeded
with synthetic data, so it never touches a real installation.

## Requirements

- `python3` with `requests`
- Playwright for Python: `pip install playwright && playwright install chromium`
- ImageMagick (`magick`), only for `--write`

## Usage

```sh
cd server-go
go build -o /tmp/deltos-go ./cmd/server
cd ..

# review first: PNGs land in a temporary directory
scripts/screenshots/run.sh --binary /tmp/deltos-go

# once they look right, overwrite the repo assets (PNG + WebP)
scripts/screenshots/run.sh --binary /tmp/deltos-go --write
```

`run.sh` starts the binary with a temporary `DATA_DIR`, waits for `/health`,
runs `seed.py` (accounts, projects, labels, tasks in every column, comments,
shared expenses, a public invite, a decided decision and a rewards catalog),
then `capture.py` logs in, switches language and theme, and writes one PNG per
subject. With `--write` it copies them into `assets/` at 2880x1800 and converts
them to 1440x900 WebP for the landing.

Run it before a release that changes the UI, and review the diff of the images.
