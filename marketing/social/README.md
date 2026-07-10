# Social Post Queue

Each ready post lives at `queue/YYYY-MM-DD-<slug>/` with:

- One final media file.
- `caption.txt` containing caption, hashtags, and cover note.
- `source-brief.txt` containing the relative path to its marketing brief.

After manual posting, move the complete directory to `posted/` and append one row to `metrics.csv`. Never place credentials, recipient lists, or raw personal data in either queue.

`metrics.csv` records observations, not assumptions. Leave unavailable values blank; do not turn missing data into zero.
